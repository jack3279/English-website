// 守卫: 家长（parent）不得读取管理类接口。
//
// 背景（线上实测发现，不是推测）：
// 用真实家长账号 lilyparent@17say.org 打线上 API，发现这几条能拿到 200：
//   GET /teachers            → **全体教师的 hourly_pay / pay_currency**（薪酬数据）
//   GET /teachers/candidates → 所有「还没入职的 teacher 角色账号」（内部人事信息）
//   GET /packages/types      → 全部课程包与定价
// 根因都是这些 GET 分支只调了 requireAuth、没调 requireRole。
// 「家长打不了管理页 UI」从来不是安全边界 —— 家长拿到 token 就能直接调接口。
//
// 另注：GET /messages 家长能访问是**正确的**，不用管——
// 它带 .eq("to_user", userId)，只返回发给自己的站内信。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

const teachers = require("../routes/teachers.js");
const packages = require("../routes/packages.js");
const leads = require("../routes/leads.js");

const PARENT = {
  id: "00000000-0000-0000-0000-0000000000aa",
  role: "parent",
  full_name: "Lily 妈妈",
  branch_id: "b-1",
};
const TEACHER = { ...PARENT, id: "00000000-0000-0000-0000-0000000000bb", role: "teacher" };
const ADMIN = { ...PARENT, id: "00000000-0000-0000-0000-0000000000cc", role: "admin" };

const authHeader = (u) => ({ authorization: `Bearer fake-jwt-${u.id}` });

// 一次 teachers 查询要两段结果：teachers 行 + profiles 行（见 listTeachers 的两步查）
function queueTeacherRows() {
  setMockResults([
    {
      data: [
        {
          id: "t1",
          profile_id: "p1",
          specialties: "kids",
          hourly_pay: 200,
          pay_currency: "PHP",
          active: true,
          wecom_user_id: null,
          created_at: "2026-01-01",
        },
      ],
      error: null,
    },
    { data: [{ id: "p1", full_name: "Emma", role: "teacher", phone: "" }], error: null },
  ]);
}

async function call(handler, url, user, method = "GET") {
  const { req, res } = applyMiddleware({
    method,
    url,
    headers: authHeader(user),
    testUser: user,
    // PATCH 分支会读 req.body；角色守卫在读 body 之前就该短路，
    // 传 {} 只是别让它拿到 undefined。
    body: method === "GET" ? undefined : {},
  });
  // mustHandler 内部已 withErrorHandler(handler)(req,res) 并执行，直接 await
  await mustHandler(handler, req, res);
  return res._captured;
}

test.afterEach(() => resetMock());

test("家长读教师名单被拒（薪酬数据不该外泄）", async () => {
  const out = await call(teachers, "/", PARENT);
  assert.equal(out.statusCode, 403);
});

test("家长读「未入职教师候选」被拒（内部人事信息）", async () => {
  const out = await call(teachers, "/candidates", PARENT);
  assert.equal(out.statusCode, 403);
});

test("家长读课程包定价被拒", async () => {
  const out = await call(packages, "/types", PARENT);
  assert.equal(out.statusCode, 403);
});

test("老师仍可读教师名单（排课要用），权限不能收得过紧", async () => {
  queueTeacherRows();
  const out = await call(teachers, "/", TEACHER);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.data.length, 1);
});

test("管理员读教师名单照常（防过度收紧）", async () => {
  queueTeacherRows();
  const out = await call(teachers, "/", ADMIN);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.data.length, 1);
});

// ── 招生线索：老师也该被拒 ────────────────────────────────────
// 这里原本只守了 parent。漏掉的角色是 **teacher**：GET /leads 不按
// assigned_to 过滤，老师能拿到全部线索（别人的跟进对象 + 家长手机号）。
// 口径三方要对齐：侧边栏入口 admin、前端路由 admin、GET /operations 不给
// 老师 new_lead 分组 → 后端也必须是 admin only。
test("老师读招生线索被拒（线索是全部人的，含他人跟进中的家长手机号）", async () => {
  const out = await call(leads, "/", TEACHER);
  assert.equal(out.statusCode, 403);
});

test("家长读招生线索被拒", async () => {
  const out = await call(leads, "/", PARENT);
  assert.equal(out.statusCode, 403);
});

test("老师改线索状态被拒（不能只锁读不锁写）", async () => {
  const out = await call(leads, "/some-lead-id", TEACHER, "PATCH");
  assert.equal(out.statusCode, 403);
});

test("管理员读招生线索照常（防过度收紧）", async () => {
  setMockResults([{ data: [], error: null }]);
  const out = await call(leads, "/", ADMIN);
  assert.equal(out.statusCode, 200);
});