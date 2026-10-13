// 学员五状态 + 级联永久删除（purge RPC）相关测试。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");
const { setMockResult, setMockResults, resetMock, getQueryLog } = require("./setup.js");

const students = withErrorHandler(require("../routes/students.js"));

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const TEACHER_ID = "00000000-0000-0000-0000-000000000002";
const STU = "00000000-0000-0000-0000-0000000000aa";

const admin = { id: ADMIN_ID, role: "admin", full_name: "Admin", branch_id: "b-1" };
const teacher = { id: TEACHER_ID, role: "teacher", full_name: "Teacher", branch_id: "b-1" };
const authHeader = (u) => ({ authorization: `Bearer fake-jwt-${u.id}` });

const PURGE_COUNTS = {
  lessons: 2,
  records: 2,
  parent_feeds: 1,
  lesson_transactions: 3,
  package_payments: 1,
  student_packages: 1,
  parent_student_links: 1,
  leave_requests: 0,
  makeups: 0,
  notifications: 4,
  notification_reads: 2,
  materials: 0,
};

async function call({ method, url, body, user }) {
  const { req, res } = applyMiddleware({
    method,
    url,
    headers: authHeader(user),
    body,
    testUser: user,
  });
  await students(req, res);
  return res._captured;
}

function stubFetch(resultBody) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(resultBody) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// adminConfirmation.verify 的 mock 队列：查邮箱 -> 密码登录成功（signOut 复用最后一项）。
function passwordOkQueue(extra) {
  return [
    { data: { full_name: "张三" }, error: null }, // students.full_name
    { data: { user: { id: ADMIN_ID, email: "admin@example.com" } }, error: null }, // auth.getUser
    { data: { user: { id: ADMIN_ID } }, error: null }, // signInWithPassword
    { data: null, error: null }, // signOut
    ...extra,
  ];
}

test.afterEach(() => resetMock());

test("POST /students 接受新增状态 leave/graduated/refunded", async () => {
  for (const status of ["leave", "graduated", "refunded"]) {
    const f = stubFetch([{ id: "stu-new", full_name: "新学员", status }]);
    try {
      const r = await call({
        method: "POST",
        url: "/",
        body: { full_name: "新学员", status },
        user: admin,
      });
      assert.equal(r.statusCode, 200, `status=${status}`);
      assert.equal(r.body.data.status, status);
    } finally {
      f.restore();
    }
  }
});

test("POST /students 拒绝未知状态", async () => {
  const r = await call({
    method: "POST",
    url: "/",
    body: { full_name: "新学员", status: "paused" },
    user: admin,
  });
  assert.equal(r.statusCode, 400);
});

test("PATCH /students/:id 可切换为休学", async () => {
  const f = stubFetch([{ id: STU, full_name: "张三", status: "leave" }]);
  try {
    const r = await call({
      method: "PATCH",
      url: `/${STU}`,
      body: { status: "leave" },
      user: admin,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(f.calls[0].init.method, "PATCH");
  } finally {
    f.restore();
  }
});

test("GET /students/status-counts 返回五状态计数与总和", async () => {
  // single 模式：5 个并行计数查询都拿到 count=3
  setMockResult({ data: null, count: 3, error: null });
  const r = await call({ method: "GET", url: "/status-counts", user: admin });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(
    { all: r.body.data.all, active: r.body.data.active, refunded: r.body.data.refunded },
    { all: 15, active: 3, refunded: 3 },
  );
});

test("delete-preview 仅 admin 可调用，老师 403", async () => {
  const r = await call({ method: "POST", url: `/${STU}/delete-preview`, body: {}, user: teacher });
  assert.equal(r.statusCode, 403);
});

test("delete-preview admin 返回各类将删除数量（dryRun）", async () => {
  setMockResult({ data: PURGE_COUNTS, error: null });
  const r = await call({ method: "POST", url: `/${STU}/delete-preview`, body: {}, user: admin });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.dryRun, true);
  assert.equal(r.body.data.lessons, 2);
  assert.equal(r.body.data.package_payments, 1);
  const rpcCall = getQueryLog().find((q) => q.ops?.[0]?.op === "rpc");
  assert.equal(rpcCall.ops[0].args[0], "purge_student_preview");
  assert.deepEqual(rpcCall.ops[0].args[1], { p_student: STU });
});

test("DELETE 缺少确认勾选或密码返回 400", async () => {
  const r1 = await call({ method: "DELETE", url: `/${STU}`, body: { current_password: "x" }, user: admin });
  assert.equal(r1.statusCode, 400);
  const r2 = await call({ method: "DELETE", url: `/${STU}`, body: { confirmed: true }, user: admin });
  assert.equal(r2.statusCode, 400);
});

test("DELETE 老师调用仍为 403（角色检查先于 body 校验）", async () => {
  const r = await call({
    method: "DELETE",
    url: `/${STU}`,
    body: { confirmed: true, current_password: "whatever" },
    user: teacher,
  });
  assert.equal(r.statusCode, 403);
});

test("DELETE 密码错误返回 400 且不调用 purge RPC", async () => {
  setMockResults(
    passwordOkQueue([]).slice(0, 2).concat([
      { error: { message: "Invalid login credentials" }, data: null }, // signInWithPassword 失败
    ]),
  );
  const r = await call({
    method: "DELETE",
    url: `/${STU}`,
    body: { confirmed: true, current_password: "wrong" },
    user: admin,
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, "CURRENT_PASSWORD_INVALID");
  assert.ok(!getQueryLog().some((q) => q.ops?.[0]?.args?.[0] === "purge_student"));
});

test("DELETE 成功：调用 purge_student、写 hard_deleted 审计、返回计数", async () => {
  setMockResults(passwordOkQueue([{ data: PURGE_COUNTS, error: null }]));
  const r = await call({
    method: "DELETE",
    url: `/${STU}`,
    body: { confirmed: true, current_password: "correct-horse" },
    user: admin,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.deleted, true);
  assert.equal(r.body.data.lessons, 2);
  assert.match(r.body.data.caveat, /旧备份/);

  const rpcCall = getQueryLog().find((q) => q.ops?.[0]?.args?.[0] === "purge_student");
  assert.ok(rpcCall, "应调用 purge_student RPC");
  assert.deepEqual(rpcCall.ops[0].args[1], { p_student: STU });

  const auditEntry = getQueryLog().find((q) => q.table === "audit_log");
  assert.ok(auditEntry, "应写审计日志");
  const insertArg = auditEntry.ops.find((o) => o.op === "insert").args[0];
  assert.equal(insertArg.action, "student.hard_deleted");
  assert.equal(insertArg.target_id, STU);
  assert.equal(insertArg.payload.full_name, "张三");
  assert.equal(insertArg.payload.lessons, 2);
});

test("DELETE 当迁移未执行（RPC 不存在）时返回 503 明确提示", async () => {
  setMockResults(
    passwordOkQueue([
      {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.purge_student" },
      },
    ]),
  );
  const r = await call({
    method: "DELETE",
    url: `/${STU}`,
    body: { confirmed: true, current_password: "correct-horse" },
    user: admin,
  });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.code, "PURGE_NOT_READY");
});

test("DELETE 学员不存在（RPC 抛 STUDENT_NOT_FOUND）返回 404", async () => {
  setMockResults(
    passwordOkQueue([
      { data: null, error: { code: "P0002", message: "STUDENT_NOT_FOUND" } },
    ]),
  );
  const r = await call({
    method: "DELETE",
    url: `/${STU}`,
    body: { confirmed: true, current_password: "correct-horse" },
    user: admin,
  });
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.code, "STUDENT_NOT_FOUND");
});
