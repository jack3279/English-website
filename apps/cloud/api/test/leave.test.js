const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const { setMockResults, resetMock, getQueryLog } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const leave = require("../routes/leave.js");
const makeups = require("../routes/makeups.js");

const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";
const L1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LR1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MK1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const ADMIN = { id: "admin1", role: "admin" };
const PARENT = { id: "p1", role: "parent" };
const TEACHER = { id: "t1", role: "teacher" };
const OTHER_TEACHER = { id: "t2", role: "teacher" };

// restPatch / restInsert 走 fetch, 单测里全部 stub 掉并记下调用
function stubFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const isArray = Array.isArray(JSON.parse(init.body || "[]"));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(isArray ? JSON.parse(init.body) : [JSON.parse(init.body)]),
    };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("GET /leave 家长只看得到自己孩子的请假单", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: S1 }], error: null }, // parent_student_links
    {
      data: [
        {
          id: LR1,
          student_id: S1,
          lesson_id: L1,
          requested_by: "p1",
          status: "pending",
          reason: "生病",
        },
      ],
      error: null,
    },
    { data: [{ id: S1, full_name: "小明" }], error: null }, // students
    { data: [{ id: "p1", full_name: "张妈妈" }], error: null }, // profiles
    {
      data: [
        { id: L1, scheduled_at: "2026-09-20T10:00:00Z", duration_min: 60, status: "scheduled" },
      ],
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({ method: "GET", url: "/", testUser: PARENT });
  await leave(req, res);

  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.items.length, 1);
  assert.equal(captured.body.data.items[0].student_name, "小明");
  assert.equal(captured.body.data.items[0].requester_name, "张妈妈");
  assert.equal(captured.body.data.items[0].lesson.duration_min, 60);
});

test("GET /leave 指定不可见学员时返回 403，不能用 student_id 绕过范围", async () => {
  resetMock();
  setMockResults([{ data: [{ student_id: S1 }], error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: `/?student_id=${S2}`,
    testUser: PARENT,
  });
  await leave(req, res);
  assert.equal(captured.statusCode, 403);
});

test("POST /leave 家长不能替别人的孩子请假", async () => {
  resetMock();
  setMockResults([{ data: [{ student_id: S1 }], error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { student_id: "22222222-2222-2222-2222-222222222222" },
    testUser: PARENT,
  });
  await leave(req, res);
  assert.equal(captured.statusCode, 403);
});

test("POST /leave/:id/review 批准 -> 同步课节 + 生成待补课单 + 通知家长", async () => {
  resetMock();
  const f = stubFetch();
  try {
    setMockResults([
      {
        data: {
          id: LR1,
          student_id: S1,
          lesson_id: L1,
          requested_by: "p1",
          status: "pending",
          created_at: "2026-09-19T10:00:00Z",
          reason: "发烧",
        },
        error: null,
      },
      { data: { id: L1, scheduled_at: "2026-09-20T10:00:00Z", duration_min: 90 }, error: null }, // lessons
      { data: null, error: null }, // makeups 去重检查
      { data: [{ parents: { profile_id: "p1" } }], error: null }, // parent links
      { data: null, error: null }, // audit_log insert
    ]);
    const { req, res, captured } = applyMiddleware({
      method: "POST",
      url: `/${LR1}/review`,
      body: { status: "approved", note: "同意" },
      testUser: ADMIN,
    });
    await leave(req, res);

    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.leave.status, "approved");
    assert.equal(captured.body.data.lesson.status, "cancelled");
    assert.equal(captured.body.data.lesson.leave_status, "approved");
    assert.ok(captured.body.data.makeup, "批准后应生成补课单");
    assert.equal(captured.body.data.makeup.status, "pending");

    const urls = f.calls.map((c) => c.url);
    assert.ok(
      urls.some((u) => u.includes("/leave_requests?id=eq.")),
      "应 PATCH leave_requests",
    );
    assert.ok(
      urls.some((u) => u.includes("/lessons?id=eq.")),
      "应 PATCH lessons",
    );
    assert.ok(
      urls.some((u) => u.includes("/makeups")),
      "应生成补课单",
    );
    assert.ok(
      urls.some((u) => u.includes("/notifications")),
      "应通知家长",
    );

    // 补课单沿用原课节时长
    const mkCall = f.calls.find((c) => c.url.includes("/makeups") && c.init.method === "POST");
    assert.equal(JSON.parse(mkCall.init.body)[0].duration_min, 90);
    // 通知是定向发给家长的
    const notifyCall = f.calls.find((c) => c.url.includes("/notifications"));
    assert.equal(JSON.parse(notifyCall.init.body)[0].target_user, "p1");
  } finally {
    f.restore();
  }
});

test("POST /leave/:id/review 重复审批返回 409", async () => {
  resetMock();
  setMockResults([
    {
      data: { id: LR1, student_id: S1, lesson_id: null, status: "approved", reason: null },
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LR1}/review`,
    body: { status: "rejected" },
    testUser: ADMIN,
  });
  await leave(req, res);
  assert.equal(captured.statusCode, 409);
});

test("POST /leave/:id/review 家长无权审批", async () => {
  resetMock();
  setMockResults([
    {
      data: { id: LR1, student_id: S1, lesson_id: null, status: "pending", reason: null },
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LR1}/review`,
    body: { status: "approved" },
    testUser: PARENT,
  });
  await leave(req, res);
  assert.equal(captured.statusCode, 403);
});

test("教师只能审批本人课程的请假，未分配教师的课节不能由其他教师审批", async () => {
  resetMock();
  setMockResults([
    {
      data: { id: LR1, student_id: S1, lesson_id: L1, status: "pending", reason: null },
      error: null,
    },
    { data: [{ student_id: S1 }], error: null },
    { data: [{ student_id: S1 }], error: null },
    {
      data: { id: L1, student_id: S1, status: "scheduled", teacher_id: null, scheduled_at: "2026-09-20T10:00:00Z", duration_min: 60 },
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LR1}/review`,
    body: { status: "approved" },
    testUser: TEACHER,
  });
  await mustHandler(leave, req, res);
  assert.equal(captured.statusCode, 403);
});

test("教师不能审批其他教师课程的请假", async () => {
  resetMock();
  setMockResults([
    {
      data: { id: LR1, student_id: S1, lesson_id: L1, status: "pending", reason: null },
      error: null,
    },
    { data: [{ student_id: S1 }], error: null },
    { data: [{ student_id: S1 }], error: null },
    {
      data: { id: L1, student_id: S1, status: "scheduled", teacher_id: OTHER_TEACHER.id, scheduled_at: "2026-09-20T10:00:00Z", duration_min: 60 },
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LR1}/review`,
    body: { status: "approved" },
    testUser: TEACHER,
  });
  await mustHandler(leave, req, res);
  assert.equal(captured.statusCode, 403);
});

test("GET /makeups 家长视角带 student_name", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: S1 }], error: null },
    {
      data: [
        { id: MK1, student_id: S1, status: "pending", duration_min: 60, original_lesson_id: L1 },
      ],
      error: null,
    },
    { data: [{ id: L1, scheduled_at: "2026-09-20T10:00:00Z", duration_min: 60 }], error: null },
    { data: [{ id: S1, full_name: "小明" }], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({ method: "GET", url: "/", testUser: PARENT });
  await makeups(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.items[0].student_name, "小明");
  assert.equal(captured.body.data.items[0].original_lesson.id, L1);
});

test("GET /makeups 指定不可见学员时返回 403，不能用 student_id 绕过范围", async () => {
  resetMock();
  setMockResults([{ data: [{ student_id: S1 }], error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: `/?student_id=${S2}`,
    testUser: PARENT,
  });
  await makeups(req, res);
  assert.equal(captured.statusCode, 403);
});

test("GET /makeups 先按补课课节派生状态过滤，再分页并返回过滤后的 total", async () => {
  resetMock();
  const rows = [
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccc01",
      student_id: S1,
      status: "scheduled",
      duration_min: 60,
      original_lesson_id: null,
      makeup_lesson_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01",
      created_at: "2026-09-20T00:00:00Z",
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccc02",
      student_id: S1,
      status: "scheduled",
      duration_min: 60,
      original_lesson_id: null,
      makeup_lesson_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
      created_at: "2026-09-19T00:00:00Z",
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccc03",
      student_id: S1,
      status: "scheduled",
      duration_min: 60,
      original_lesson_id: null,
      makeup_lesson_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03",
      created_at: "2026-09-18T00:00:00Z",
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccc04",
      student_id: S1,
      status: "scheduled",
      duration_min: 60,
      original_lesson_id: null,
      makeup_lesson_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04",
      created_at: "2026-09-17T00:00:00Z",
    },
  ];
  setMockResults([
    { data: rows, error: null },
    {
      data: [
        { id: rows[0].makeup_lesson_id, status: "completed", scheduled_at: "2026-09-21T10:00:00Z", teacher_id: TEACHER.id },
        { id: rows[1].makeup_lesson_id, status: "cancelled", scheduled_at: "2026-09-21T11:00:00Z", teacher_id: TEACHER.id },
        { id: rows[2].makeup_lesson_id, status: "scheduled", scheduled_at: "2026-09-21T12:00:00Z", teacher_id: TEACHER.id },
        { id: rows[3].makeup_lesson_id, status: "no_show", scheduled_at: "2026-09-21T13:00:00Z", teacher_id: TEACHER.id },
      ],
      error: null,
    },
  ]);

  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/?status=done&page=1&pageSize=10",
    testUser: ADMIN,
  });
  await makeups(req, res);

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.body.data.items.map((i) => i.id), [rows[0].id]);
  assert.equal(captured.body.data.items[0].status, "done");
  assert.equal(captured.body.data.total, 1);

  resetMock();
  setMockResults([
    { data: rows, error: null },
    {
      data: [
        { id: rows[0].makeup_lesson_id, status: "completed" },
        { id: rows[1].makeup_lesson_id, status: "cancelled" },
        { id: rows[2].makeup_lesson_id, status: "scheduled" },
        { id: rows[3].makeup_lesson_id, status: "no_show" },
      ],
      error: null,
    },
    { data: [{ id: S1, full_name: "小明" }], error: null },
  ]);
  const pageTwo = applyMiddleware({
    method: "GET",
    url: "/?status=cancelled&page=1&pageSize=1",
    testUser: ADMIN,
  });
  await makeups(pageTwo.req, pageTwo.res);
  assert.deepEqual(pageTwo.captured.body.data.items.map((i) => i.id), [rows[1].id]);
  assert.equal(pageTwo.captured.body.data.items[0].status, "cancelled");
  assert.equal(pageTwo.captured.body.data.total, 2, "cancelled/no_show 先合并过滤，total 不能受页大小影响");
});

test("GET /makeups pending 状态直接下推数据库，非法分页参数回退默认值", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        {
          id: MK1,
          student_id: S1,
          status: "pending",
          duration_min: 60,
          original_lesson_id: null,
          makeup_lesson_id: null,
          created_at: "2026-09-20T00:00:00Z",
        },
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [{ id: S1, full_name: "小明" }], error: null },
  ]);

  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/?status=pending&page=abc&pageSize=-5",
    testUser: ADMIN,
  });
  await makeups(req, res);

  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.page, 1);
  assert.equal(captured.body.data.pageSize, 1);
  assert.equal(captured.body.data.total, 1);
  const makeupQuery = getQueryLog().find((q) => q.table === "makeups");
  assert.ok(makeupQuery.ops.some((op) => op.op === "eq" && op.args[0] === "status" && op.args[1] === "pending"));
});

test("PATCH /makeups/:id 排期 -> 生成真实课节并回填 makeup_lesson_id", async () => {
  resetMock();
  const f = stubFetch();
  try {
    setMockResults([
      {
        data: {
          id: MK1,
          student_id: S1,
          status: "pending",
          duration_min: 60,
          makeup_lesson_id: null,
          original_lesson_id: null,
          scheduled_at: null,
        },
        error: null,
      },
      { data: { profile_id: "33333333-3333-3333-3333-333333333333", active: true }, error: null }, // teacher
      { data: [], error: null }, // conflict candidates
      { data: null, error: null }, // deterministic lesson does not exist
      { data: [], error: null }, // parent recipients
      { data: null, error: null }, // audit
    ]);
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${MK1}`,
      body: {
        status: "scheduled",
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        teacher_id: "33333333-3333-3333-3333-333333333333",
      },
      testUser: ADMIN,
    });
    await mustHandler(makeups, req, res);

    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.status, "scheduled");
    assert.match(captured.body.data.makeup_lesson_id, /^[0-9a-f-]{36}$/);
    const lessonCall = f.calls.find((c) => c.url.includes("/lessons") && c.init.method === "POST");
    assert.equal(JSON.parse(lessonCall.init.body)[0].id, captured.body.data.makeup_lesson_id);
    const patchCall = f.calls.find((c) => c.init.method === "PATCH");
    assert.ok(patchCall.url.includes("/makeups?id=eq."));
  } finally {
    f.restore();
  }
});

test("PATCH /makeups/:id 排期缺老师 -> 400", async () => {
  resetMock();
  setMockResults([
    {
      data: {
        id: MK1,
        student_id: S1,
        status: "pending",
        duration_min: 60,
        makeup_lesson_id: null,
        original_lesson_id: null,
        scheduled_at: null,
      },
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "PATCH",
    url: `/${MK1}`,
    body: { status: "scheduled", scheduled_at: new Date(Date.now() + 86400000).toISOString() },
    testUser: ADMIN,
  });
  await mustHandler(makeups, req, res);
  assert.equal(captured.statusCode, 400);
});

test("POST /makeups 家长申请必须选择原课节", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { student_id: S1 },
    testUser: PARENT,
  });
  await mustHandler(makeups, req, res);
  assert.equal(captured.statusCode, 400);
});
