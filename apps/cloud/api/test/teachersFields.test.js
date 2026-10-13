// 教师管理页字段口径的回归守卫。
//
// 背景（页面上一屏能同时看到三个问题）：
//   ① 姓名全是 "?"       —— profiles 查询 select 了不存在的 email 列 → 整条 400，
//                            而错误被忽略 → full_name 全空
//   ② 专长渲染出原始 JSON —— teachers.specialties 是 text 列，历史混存
//                            "ESL, Phonics" 与 '["kids","phonics"]' 两种写法
//   ③ 课酬数字对不上      —— 用了单位存疑的历史字段 default_rate（元/分混存），
//                            与课酬结算、Excel 导入用的 hourly_pay 脱节
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

// withErrorHandler 会返回新函数, 挂在原函数上的归一化工具要从模块本身取
const teachersModule = require("../routes/teachers.js");
const teachers = withErrorHandler(teachersModule);

const ADMIN = {
  id: "00000000-0000-0000-0000-000000000001",
  role: "admin",
  full_name: "Admin",
  branch_id: "b-1",
};
const authHeader = (u) => ({ authorization: `Bearer fake-jwt-${u.id}` });

function stubFetch(result) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test.afterEach(() => resetMock());

// ---------- 专长归一化规则 ----------

test("parseSpecialties 兼容历史两种写法与中文分隔符", () => {
  assert.deepEqual(teachersModule.parseSpecialties("ESL, Phonics"), ["ESL", "Phonics"]);
  assert.deepEqual(teachersModule.parseSpecialties('["kids","phonics"]'), ["kids", "phonics"]);
  assert.deepEqual(teachersModule.parseSpecialties(["kids", " phonics "]), ["kids", "phonics"]);
  assert.deepEqual(teachersModule.parseSpecialties("自然拼读、少儿口语"), ["自然拼读", "少儿口语"]);
  assert.deepEqual(teachersModule.parseSpecialties(""), []);
  assert.deepEqual(teachersModule.parseSpecialties(null), []);
});

test("parseSpecialties 对非法 JSON 不抛错, 退化为按分隔符切", () => {
  assert.deepEqual(teachersModule.parseSpecialties("[kids, phonics]"), ["[kids", "phonics]"]);
});

test("serializeSpecialties 统一存成逗号串; 空则不存", () => {
  assert.equal(teachersModule.serializeSpecialties(["kids", "phonics"]), "kids, phonics");
  assert.equal(teachersModule.serializeSpecialties('["kids","phonics"]'), "kids, phonics");
  assert.equal(teachersModule.serializeSpecialties([]), null);
  assert.equal(teachersModule.serializeSpecialties(null), null);
});

// ---------- 接口行为 ----------

test("GET /teachers/candidates 排除已入库教师", async () => {
  setMockResults([
    {
      data: [
        { id: "p1", full_name: "A 老师", phone: null, role: "teacher" },
        { id: "p2", full_name: "B 老师", phone: "138", role: "teacher" },
      ],
      error: null,
    },
    { data: [{ profile_id: "p1" }], error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/candidates",
    headers: authHeader(ADMIN),
    testUser: ADMIN,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.deepEqual(
    res._captured.body.data.map((x) => x.id),
    ["p2"],
  );
});

test("PATCH /teachers/:id 写 raw PATCH, 专长归一化 + 写 hourly_pay", async () => {
  resetMock();
  const f = stubFetch([{ id: "t1", specialties: "kids, beginner", hourly_pay: 250 }]);
  try {
    const { req, res } = applyMiddleware({
      method: "PATCH",
      url: "/t1",
      headers: authHeader(ADMIN),
      body: { specialties: '["kids","beginner"]', hourly_pay: 250 },
      testUser: ADMIN,
    });
    await teachers(req, res);
    assert.equal(res._captured.statusCode, 200);

    const patched = f.calls.find((c) => (c.init?.method || "GET") === "PATCH");
    assert.ok(patched, "必须真的发出 PATCH");
    const sent = JSON.parse(patched.init.body);
    assert.equal(sent.specialties, "kids, beginner");
    assert.equal(sent.hourly_pay, 250);
    assert.equal(sent.default_rate, undefined, "不得再碰历史字段 default_rate");
  } finally {
    f.restore();
  }
});

test("PATCH /teachers/:id 没有任何可更新字段时报 400", async () => {
  resetMock();
  const { req, res } = applyMiddleware({
    method: "PATCH",
    url: "/t1",
    headers: authHeader(ADMIN),
    body: {},
    testUser: ADMIN,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 400);
});

// ---------- 静态守卫 ----------

test("不得 select profiles.email（该列不存在, 会让整条查询 400 且姓名全空）", () => {
  const dir = path.join(__dirname, "..", "routes");
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // 只看 .from("profiles") 之后紧跟的那段 select 列表
    const re = new RegExp("\\.from\\(\\s*[\"']profiles[\"']\\s*\\)[\\s\\S]{0,200}?email", "g");
    if (re.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "profiles 表没有 email 列");
});
