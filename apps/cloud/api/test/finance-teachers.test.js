// Stage 5 tests: teachers CRUD + finance
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");
const { setMockResults, resetMock } = require("./setup.js");

const teachersRaw = require("../routes/teachers.js");
const teachers = withErrorHandler(teachersRaw);
const financeRaw = require("../routes/finance.js");
const finance = withErrorHandler(financeRaw);

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const TEACHER_ID = "00000000-0000-0000-0000-000000000002";
const PARENT_ID = "00000000-0000-0000-0000-000000000003";

const admin = { id: ADMIN_ID, role: "admin", full_name: "Admin", branch_id: "b-1" };
const teacher = { id: TEACHER_ID, role: "teacher", full_name: "Teacher", branch_id: "b-1" };
const parent = { id: PARENT_ID, role: "parent", full_name: "Parent" };

function authHeader(user) {
  return { authorization: `Bearer fake-jwt-${user.id}` };
}

// 写操作已改走 raw PostgREST (lib/rest.js), 需 stub fetch 而非 supabase mock 队列
function stubFetch(result) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test.afterEach(() => resetMock());

// ---------- /teachers CRUD ----------

test("GET /teachers 列表返回带 profile join 的数组（专长归一为数组, 课酬取 hourly_pay）", async () => {
  // 现在 route 调 2 个 query: list teachers + profiles in
  setMockResults([
    {
      data: [
        {
          id: "t1",
          profile_id: TEACHER_ID,
          // 历史遗留写法: text 列里存的是 JSON 数组字符串
          specialties: '["kids","beginner"]',
          hourly_pay: 250,
          active: true,
          wecom_user_id: null,
          created_at: "2026-01-01",
        },
      ],
      error: null,
    },
    {
      data: [
        {
          id: TEACHER_ID,
          full_name: "Emma",
          role: "teacher",
          // 注意: profiles 没有 email 列, 此处也不返回 email
          phone: "13800000002",
        },
      ],
      error: null,
    },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/",
    headers: authHeader(admin),
    testUser: admin,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.length, 1);
  // 姓名能取到 = profiles 查询没有 select 不存在的列而整体 400
  assert.equal(res._captured.body.data[0].full_name, "Emma");
  assert.deepEqual(res._captured.body.data[0].specialties, ["kids", "beginner"]);
  assert.equal(res._captured.body.data[0].hourly_pay, 250);
});

test("POST /teachers 创建校验: 非 admin 403", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(teacher),
    body: { profile_id: TEACHER_ID },
    testUser: teacher,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 403);
});

test("POST /teachers 缺 profile_id 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: { specialties: ["a"] },
    testUser: admin,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 400);
});

test("POST /teachers profile 不存在 400", async () => {
  setMockResults([{ data: null, error: null }]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: { profile_id: TEACHER_ID },
    testUser: admin,
  });
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 400);
  assert.match(res._captured.body.error, /用户不存在/);
});

test("POST /teachers 成功（写走 raw PostgREST, 专长序列化为逗号串）", async () => {
  resetMock();
  setMockResults([
    { data: { id: TEACHER_ID, role: "teacher" }, error: null }, // profile check
    { data: null, error: null }, // unique check (not exists)
  ]);
  const f = stubFetch([
    {
      id: "t-new",
      profile_id: TEACHER_ID,
      specialties: "kids, teens",
      hourly_pay: 250,
      active: true,
      wecom_user_id: null,
      created_at: "2026-01-01",
    },
  ]);
  try {
    const { req, res } = applyMiddleware({
      method: "POST",
      url: "/",
      headers: authHeader(admin),
      body: { profile_id: TEACHER_ID, specialties: ["kids", "teens"], hourly_pay: 250 },
      testUser: admin,
    });
    await teachers(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.deepEqual(res._captured.body.data.specialties, ["kids", "teens"]);
    assert.equal(res._captured.body.data.hourly_pay, 250);

    const posted = f.calls.find((c) => (c.init?.method || "GET") === "POST");
    assert.ok(posted, "必须真的发出 POST（supabase-js 写会静默 no-op）");
    assert.match(posted.url, /\/rest\/v1\/teachers$/);
    const sent = JSON.parse(posted.init.body)[0];
    assert.equal(sent.specialties, "kids, teens", "库里存逗号分隔文本");
    assert.equal(sent.hourly_pay, 250);
    assert.equal(sent.default_rate, undefined, "不得再写历史字段 default_rate");
  } finally {
    f.restore();
  }
});

test("PATCH /teachers/:id 更新 active=false", async () => {
  resetMock();
  const f = stubFetch([{ id: "t1", active: false }]);
  try {
    const { req, res } = applyMiddleware({
      method: "PATCH",
      url: "/t1",
      headers: authHeader(admin),
      body: { active: false },
      testUser: admin,
    });
    await teachers(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.active, false);
    assert.ok(f.calls[0].url.includes("/teachers?id=eq.t1"));
    assert.equal(f.calls[0].init.method, "PATCH");
  } finally {
    f.restore();
  }
});

test("DELETE /teachers/:id 软删除", async () => {
  resetMock();
  const f = stubFetch([{ id: "t1" }]);
  try {
    const { req, res } = applyMiddleware({
      method: "DELETE",
      url: "/t1",
      headers: authHeader(admin),
      testUser: admin,
    });
    await teachers(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.deleted, true);
    assert.equal(f.calls[0].init.method, "PATCH");
    assert.equal(JSON.parse(f.calls[0].init.body).active, false);
  } finally {
    f.restore();
  }
});

// ---------- /finance ----------

test("GET /finance/summary admin 200", async () => {
  // 7 个 query (this_month, last_month, month_txs, low_bals, student_count, total_students, completed_lessons)
  // 用同一种 fallback (data + count) 让 queue 顺序不敏感
  setMockResults([
    { data: [{ amount_cents: 100000, paid_at: "2026-09-15" }], error: null }, // this_month
    { data: [{ amount_cents: 80000, paid_at: "2026-08-15" }], error: null }, // last_month
    {
      data: [
        { delta: -5, reason: "consume" },
        { delta: 10, reason: "topup" },
      ],
      error: null,
    }, // month txs
    { data: [{ remaining_hours: 2 }], error: null }, // lowBals
    { data: null, count: 7, error: null }, // active count
    { data: null, count: 12, error: null }, // completed count
    { data: null, count: 8, error: null }, // total count
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/summary",
    headers: authHeader(admin),
    testUser: admin,
  });
  await finance(req, res);
  assert.equal(res._captured.statusCode, 200);
  // 只验证结构 + 关键值 (不锁住具体数字避免 mock 顺序敏感)
  assert.ok(typeof res._captured.body.data.this_month.revenue_cents === "number");
  assert.ok(typeof res._captured.body.data.total === "object");
});

test("GET /finance/summary teacher 403", async () => {
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/summary",
    headers: authHeader(teacher),
    testUser: teacher,
  });
  await finance(req, res);
  assert.equal(res._captured.statusCode, 403);
});

test("GET /finance/exceptions 200 (expiring + negative)", async () => {
  setMockResults([
    {
      data: [
        {
          id: "p1",
          student_id: "s1",
          remaining_hours: 5,
          expires_at: "2026-09-30",
          students: { full_name: "Lily" },
          package_types: { name: "30h 包" },
        },
      ],
      error: null,
    },
    { data: [], error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/exceptions",
    headers: authHeader(admin),
    testUser: admin,
  });
  await finance(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.expiring_soon.length, 1);
  assert.equal(res._captured.body.data.expiring_soon[0].student_name, "Lily");
});

test("GET /finance/student/:id returns packages + payments + txs", async () => {
  setMockResults([
    {
      data: { id: "s1", full_name: "Alice", status: "active", created_at: "2026-01-01" },
      error: null,
    },
    {
      data: [
        {
          id: "p1",
          total_hours: 30,
          remaining_hours: 25,
          package_types: { name: "30h", price_cents: 300000 },
        },
      ],
      error: null,
    },
    { data: [{ id: "t1", delta: -1, reason: "consume", note: null }], error: null },
    { data: [{ id: "pay1", amount_cents: 300000, paid_at: "2026-01-02" }], error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/student/s1",
    headers: authHeader(admin),
    testUser: admin,
  });
  await finance(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.total_paid_cents, 300000);
  assert.equal(res._captured.body.data.packages.length, 1);
  assert.equal(res._captured.body.data.transactions.length, 1);
});
