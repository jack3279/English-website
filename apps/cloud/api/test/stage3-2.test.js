// Stage 3.2 tests: internal messages
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");
const { setMockResults, resetMock } = require("./setup.js");

const messagesRaw = require("../routes/messages.js");
const messages = withErrorHandler(messagesRaw);
const packagesRaw = require("../routes/packages.js");
const packages = withErrorHandler(packagesRaw);
const studentsRaw = require("../routes/students.js");
const students = withErrorHandler(studentsRaw);

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const TEACHER_ID = "00000000-0000-0000-0000-000000000002";
const PARENT_ID = "00000000-0000-0000-0000-000000000003";
const MSG_ID = "00000000-0000-0000-0000-0000000000ff";
const OTHER_USER = "00000000-0000-0000-0000-0000000000ee";

const admin = { id: ADMIN_ID, role: "admin", full_name: "Admin", branch_id: "b-1" };
const teacher = { id: TEACHER_ID, role: "teacher", full_name: "Teacher", branch_id: "b-1" };
const parent = { id: PARENT_ID, role: "parent", full_name: "Parent" };

function authHeader(user) {
  return { authorization: `Bearer fake-jwt-${user.id}` };
}

test.afterEach(() => resetMock());

// ---------- /messages ----------

test("GET /messages returns admin inbox with sender profiles", async () => {
  setMockResults([
    {
      data: [
        {
          id: "m1",
          from_user: TEACHER_ID,
          subject: "test",
          body: "hi",
          to_user: ADMIN_ID,
          read_at: null,
          created_at: "2026-09-14T10:00:00Z",
        },
      ],
      error: null,
    },
    { data: [{ id: TEACHER_ID, full_name: "Teacher", role: "teacher" }], error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/",
    headers: authHeader(admin),
    testUser: admin,
  });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.ok(Array.isArray(res._captured.body.data));
  assert.equal(res._captured.body.data.length, 1);
  assert.equal(res._captured.body.data[0].from_user_profile.full_name, "Teacher");
});

test("GET /messages/unread-count returns count", async () => {
  setMockResults([{ data: null, error: null, count: 3 }]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/unread-count",
    headers: authHeader(admin),
    testUser: admin,
  });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.count, 3);
});

test("POST /messages admin -> teacher creates message", async () => {
  setMockResults([
    { data: { id: ADMIN_ID, role: "admin", branch_id: null }, error: null },
    {
      data: { id: "m-new", subject: "Hi", body: "test", to_user: TEACHER_ID, from_user: ADMIN_ID },
      error: null,
    },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: { to_user: TEACHER_ID, subject: "Hi", body: "test" },
    testUser: admin,
  });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.from_user, ADMIN_ID);
});

test("POST /messages missing body returns 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: { to_user: TEACHER_ID, subject: "x" },
    testUser: admin,
  });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 400);
});

test("POST /messages 家长也能发 (给孩子老师/教务留言)", async () => {
  // 设计上 POST /messages 不限 role: 任何登录用户都能发, 家长要给老师/教务留反馈.
  // 收件人会校验存在性(profiles 查不到 -> 400), 不是任意字符串都能塞。
  setMockResults([
    { data: { id: ADMIN_ID, role: "admin", branch_id: null }, error: null },
    { data: { id: "m-new" }, error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(parent),
    body: { to_user: ADMIN_ID, body: "feedback" },
    testUser: parent,
  });
  await messages(req, res);
  // parent 可以发站内信, 验证 200
  assert.equal(res._captured.statusCode, 200);
});

test("PATCH /messages/:id own message marks read", async () => {
  // messages.js 的已读标记走 raw PostgREST fetch(supabase-js .update() 在 Workers 会静默 noop),
  // 单测环境连不上真库会 500, 这里必须把网络调用 stub 掉
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ id: MSG_ID, read_at: "2026-09-14T10:00:00Z" }]),
  });
  try {
    setMockResults([
      { data: { id: MSG_ID, to_user: ADMIN_ID, read_at: null }, error: null },
      { data: { id: MSG_ID, read_at: "2026-09-14T10:00:00Z" }, error: null },
    ]);
    const { req, res } = applyMiddleware({
      method: "PATCH",
      url: `/${MSG_ID}`,
      headers: authHeader(admin),
      testUser: admin,
    });
    await messages(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.ok(res._captured.body.data.read_at);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /messages/:id other user's message 403", async () => {
  setMockResults([{ data: { id: MSG_ID, to_user: OTHER_USER, read_at: null }, error: null }]);
  const { req, res } = applyMiddleware({
    method: "PATCH",
    url: `/${MSG_ID}`,
    headers: authHeader(admin),
    testUser: admin,
  });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 403);
});

test("GET /messages without auth 401", async () => {
  const { req, res } = applyMiddleware({ method: "GET", url: "/" });
  await messages(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("POST /students/:id/adjust-hours admin 加课时 + 写流水", async () => {
  const STU = "00000000-0000-0000-0000-0000000000dd";
  setMockResults([
    { data: { id: STU }, error: null },
    { data: { remaining_hours: 10 }, error: null },
    { data: { id: "tx-new", delta: 5, reason: "adjust", note: "生日赠送" }, error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: `/${STU}/adjust-hours`,
    headers: authHeader(admin),
    body: { delta: 5, reason: "生日赠送" },
    testUser: admin,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.new_balance, 15);
  assert.equal(res._captured.body.data.transaction.delta, 5);
});

test("POST /students/:id/adjust-hours missing reason 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: `/00000000-0000-0000-0000-0000000000dd/adjust-hours`,
    headers: authHeader(admin),
    body: { delta: 5 },
    testUser: admin,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 400);
});

test("POST /students/:id/adjust-hours parent 403", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: `/00000000-0000-0000-0000-0000000000dd/adjust-hours`,
    headers: authHeader(parent),
    body: { delta: 5, reason: "test" },
    testUser: parent,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 403);
});

// ---------- /packages stage 4.4 ----------

test("GET /packages/types/:id returns type + sales stats", async () => {
  const PT_ID = "00000000-0000-0000-0000-0000000000aa";
  setMockResults([
    {
      data: { id: PT_ID, name: "30h 包", hours: 30, price_cents: 300000, active: true },
      error: null,
    },
    {
      data: [
        {
          id: "sp1",
          student_id: "s1",
          total_hours: 30,
          remaining_hours: 20,
          purchased_at: "2026-01-01",
        },
      ],
      error: null,
    },
    { data: null, error: null, count: 1 },
    { data: [{ amount_cents: 300000, paid_at: "2026-01-01" }], error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "GET",
    url: `/types/${PT_ID}`,
    headers: authHeader(admin),
    testUser: admin,
  });
  await packages(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.sold_count, 1);
  assert.equal(res._captured.body.data.total_revenue_cents, 300000);
  assert.equal(res._captured.body.data.sales.length, 1);
});

test("POST /packages/purchase creates sp + payment atomically", async () => {
  const PT_ID = "00000000-0000-0000-0000-0000000000bb";
  const STU_ID = "00000000-0000-0000-0000-0000000000cc";
  setMockResults([
    // 先查学员是否存在(不查的话外键错误会裸奔成 500)
    { data: { id: STU_ID, full_name: "测试学员" }, error: null },
    { data: { id: PT_ID, name: "10h 包", hours: 10, active: true }, error: null },
    {
      data: {
        id: "sp-new",
        student_id: STU_ID,
        package_type_id: PT_ID,
        total_hours: 10,
        remaining_hours: 10,
      },
      error: null,
    },
    { data: { id: "pay-new", student_package_id: "sp-new", amount_cents: 100000 }, error: null },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/purchase",
    headers: authHeader(admin),
    body: { student_id: STU_ID, package_type_id: PT_ID, amount_cents: 100000, method: "alipay" },
    testUser: admin,
  });
  await packages(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.student_package.id, "sp-new");
  assert.equal(res._captured.body.data.payment.id, "pay-new");
});

test("POST /packages/purchase rejected if package inactive", async () => {
  const PT_ID = "00000000-0000-0000-0000-0000aaaaaaaa";
  setMockResults([{ data: { id: PT_ID, name: "下架包", hours: 10, active: false }, error: null }]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/purchase",
    headers: authHeader(admin),
    body: {
      student_id: "00000000-0000-0000-0000-0000bbbbbbbb",
      package_type_id: PT_ID,
      amount_cents: 100000,
    },
    testUser: admin,
  });
  await packages(req, res);
  assert.equal(res._captured.statusCode, 400);
  assert.equal(res._captured.body.error, "该课时包已下架");
});
