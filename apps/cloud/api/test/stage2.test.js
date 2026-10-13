// Stage 2 tests: student CRUD + schedule CRUD + conflict + public leads + authz
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");
const { setMockResult, setMockResults, resetMock } = require("./setup.js");

const studentsRaw = require("../routes/students.js");
const schedulesRaw = require("../routes/schedules.js");
const leadsRaw = require("../routes/leads.js");
const students = withErrorHandler(studentsRaw);
const schedules = withErrorHandler(schedulesRaw);
const leads = withErrorHandler(leadsRaw);

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const TEACHER_ID = "00000000-0000-0000-0000-000000000002";
const PARENT_ID = "00000000-0000-0000-0000-000000000003";
const STU_1 = "00000000-0000-0000-0000-0000000000aa";
const STU_2 = "00000000-0000-0000-0000-0000000000bb";
const TCH_1 = "00000000-0000-0000-0000-0000000000cc";

const admin = { id: ADMIN_ID, role: "admin", full_name: "Admin", branch_id: "b-1" };
const teacher = { id: TEACHER_ID, role: "teacher", full_name: "Teacher", branch_id: "b-1" };
const parent = { id: PARENT_ID, role: "parent", full_name: "Parent" };

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

function authHeader(user) {
  return { authorization: `Bearer fake-jwt-${user.id}` };
}

test.afterEach(() => resetMock());

// ---------- /students ----------

test("POST /students admin creates successfully", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '[{"id":"stu-new","full_name":"New Student","status":"active"}]',
  });
  try {
    setMockResult({
      data: { id: "stu-new", full_name: "New Student", status: "active" },
      error: null,
    });
    const { req, res } = applyMiddleware({
      method: "POST",
      url: "/",
      headers: authHeader(admin),
      body: { full_name: "New Student", status: "active" },
      testUser: admin,
    });
    await students(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.id, "stu-new");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /students parent is rejected 403", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(parent),
    body: { full_name: "x" },
    testUser: parent,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 403);
});

test("POST /students missing full_name returns 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: { status: "active" },
    testUser: admin,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 400);
  assert.equal(res._captured.body.code, "BAD_REQUEST");
});

test("PATCH /students/:id admin updates", async () => {
  resetMock();
  const f = stubFetch([{ id: STU_1, full_name: "Updated" }]);
  try {
    const { req, res } = applyMiddleware({
      method: "PATCH",
      url: `/${STU_1}`,
      headers: authHeader(admin),
      body: { full_name: "Updated" },
      testUser: admin,
    });
    await students(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.full_name, "Updated");
    assert.ok(f.calls[0].url.includes(`/students?id=eq.${STU_1}`));
    assert.equal(f.calls[0].init.method, "PATCH");
  } finally {
    f.restore();
  }
});

test("DELETE /students/:id teacher is rejected (admin only)", async () => {
  const { req, res } = applyMiddleware({
    method: "DELETE",
    url: `/${STU_1}`,
    headers: authHeader(teacher),
    testUser: teacher,
  });
  await students(req, res);
  assert.equal(res._captured.statusCode, 403);
});

// ---------- /schedules ----------

test("POST /schedules admin creates successfully", async () => {
  setMockResults([
    { data: [], error: null },
    {
      data: { id: "sch-new", student_id: STU_2, teacher_id: TCH_1, status: "scheduled" },
      error: null,
    },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: {
      student_id: STU_2,
      teacher_id: TCH_1,
      scheduled_at: "2026-09-20T10:00:00Z",
      duration_min: 30,
    },
    testUser: admin,
  });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.id, "sch-new");
});

test("POST /schedules parent is rejected 403", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(parent),
    body: { student_id: STU_2, teacher_id: TCH_1, scheduled_at: "x" },
    testUser: parent,
  });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 403);
});

test("POST /schedules conflict with existing teacher lesson returns 409", async () => {
  // existing lesson at same time with same teacher
  setMockResults([
    {
      data: [
        {
          id: "sch-existing",
          teacher_id: TCH_1,
          student_id: "00000000-0000-0000-0000-0000000000dd",
          scheduled_at: "2026-09-20T10:00:00Z",
          duration_min: 30,
          status: "scheduled",
        },
      ],
      error: null,
    },
  ]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    headers: authHeader(admin),
    body: {
      student_id: STU_2,
      teacher_id: TCH_1,
      scheduled_at: "2026-09-20T10:00:00Z",
      duration_min: 30,
    },
    testUser: admin,
  });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 409);
  assert.equal(res._captured.body.code, "SCHEDULE_CONFLICT");
});

// ---------- /leads (public) ----------

test("POST /leads public (no token) returns 200", async () => {
  setMockResult({ data: { id: "lead-new", status: "new" }, error: null });
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { parent_name: "Test Parent", parent_phone: "13800138000" },
  });
  await leads(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.status, "new");
});

test("POST /leads missing parent_phone returns 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { parent_name: "Test Parent" },
  });
  await leads(req, res);
  assert.equal(res._captured.statusCode, 400);
});

test("POST /leads invalid phone format returns 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { parent_name: "张妈妈", parent_phone: "1380013800" }, // 10 digits
  });
  await leads(req, res);
  assert.equal(res._captured.statusCode, 400);
  assert.match(res._captured.body.details.fieldErrors.parent_phone[0], /手机号/);
});

test("POST /leads valid 11-digit CN phone passes validation", async () => {
  setMockResults([{ data: { id: "lead-new", status: "new" }, error: null }]);
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { parent_name: "张妈妈", parent_phone: "13800138000" },
  });
  await leads(req, res);
  assert.equal(res._captured.statusCode, 200);
});

test("GET /leads admin lists", async () => {
  setMockResult({ data: [{ id: "lead-1", status: "new" }], error: null, count: 1 });
  const { req, res } = applyMiddleware({
    method: "GET",
    url: "/",
    headers: authHeader(admin),
    testUser: admin,
  });
  await leads(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.ok(Array.isArray(res._captured.body.data));
  assert.equal(res._captured.body.data.length, 1);
});
