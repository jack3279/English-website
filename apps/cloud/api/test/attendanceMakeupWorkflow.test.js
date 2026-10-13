const test = require("node:test"),
  assert = require("node:assert/strict");
const { setMockResults, resetMock } = require("./setup.js");
const absence = require("../lib/absence.js"),
  makeup = require("../lib/makeupWorkflow.js"),
  ledger = require("../lib/studentHourLedger.js"),
  store = require("../lib/secureStore.js");
const { withLock } = require("../lib/workflowLock.js");
class Bucket {
  constructor() {
    this.files = new Map();
    this.v = 0;
  }
  async get(k) {
    const r = this.files.get(k);
    return r ? { etag: r.etag, json: async () => JSON.parse(r.data) } : null;
  }
  async put(k, data, o) {
    const old = this.files.get(k);
    if (
      (o?.onlyIf?.etagMatches && old?.etag !== o.onlyIf.etagMatches) ||
      (o?.onlyIf?.get?.("If-None-Match") === "*" && old)
    )
      return null;
    const r = { etag: String(++this.v), data };
    this.files.set(k, r);
    return r;
  }
}
const teacher = "22222222-2222-4222-8222-222222222222",
  student = "33333333-3333-4333-8333-333333333333",
  course = "44444444-4444-4444-8444-444444444444",
  lessonId = "55555555-5555-4555-8555-555555555555",
  makeupId = "66666666-6666-4666-8666-666666666666";
const req = { context: { userId: teacher, role: "admin" }, reqId: "workflow-qa" };
const lesson = {
  id: lessonId,
  student_id: student,
  teacher_id: teacher,
  course_id: course,
  scheduled_at: "2026-10-01T01:00:00Z",
  duration_min: 90,
  status: "scheduled",
};
const originalFetch = globalThis.fetch;
let writes, failPatch;
test.beforeEach(() => {
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: new Bucket(),
    ENCRYPTION_KEY: Buffer.alloc(32, 12).toString("base64"),
    SUPABASE_URL: "https://workflow.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "qa",
  };
  writes = [];
  failPatch = false;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body || "[]");
    writes.push({ url: String(url), method: options.method, body });
    const bad = failPatch && options.method === "PATCH" && String(url).includes("/lessons?");
    return {
      ok: !bad,
      status: bad ? 503 : 200,
      text: async () => (bad ? "unavailable" : JSON.stringify(Array.isArray(body) ? body : [body])),
    };
  };
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__CLOUDFLARE_ENV;
  resetMock();
});
test("缺席扣1.5小时：固定流水编号，重复请求只扣一次，教师课酬按快照计入", async () => {
  setMockResults([{data:{profile_id:teacher,hourly_pay:40,pay_currency:"PHP"}},{ data: null }, { data: { remaining_hours: 5 } }]);
  const first = await absence.register(req, lesson, {
    deduct_hours: true,
    reason: "未提前请假，按约定扣课时",
  });
  assert.equal(first.deducted_hours, 1.5);
  assert.equal(first.teacher_pay_amount, 60);
  const again = await absence.register(
    req,
    { ...lesson, status: "no_show" },
    { deduct_hours: true, reason: "未提前请假，按约定扣课时" },
  );
  assert.equal(again.alreadyRecorded, true);
  const transactions = writes.filter((w) => w.url.includes("/lesson_transactions"));
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].body[0].delta, -1.5);
  assert.match(transactions[0].body[0].id, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    () =>
      absence.register(
        req,
        { ...lesson, status: "no_show" },
        { deduct_hours: false, reason: "调整" },
      ),
    (e) => e.code === "ATTENDANCE_CHANGED",
  );
});
test("缺席不扣课时无消课流水，余额不足拒绝扣课且不改变状态", async () => {
  setMockResults([{data:{profile_id:teacher,hourly_pay:40,pay_currency:"PHP"}}]);
  const result = await absence.register(req, lesson, { deduct_hours: false, reason: "" });
  assert.equal(result.deducted_hours, 0);
  assert.equal(
    writes.some((w) => w.url.includes("lesson_transactions")),
    false,
  );
  writes = [];
  setMockResults([{data:{profile_id:teacher,hourly_pay:40,pay_currency:"PHP"}},{ data: null }, { data: { remaining_hours: 1 } }]);
  await assert.rejects(
    () =>
      absence.register(req, { ...lesson, id: makeupId }, { deduct_hours: true, reason: "按约定" }),
    (e) => e.code === "INSUFFICIENT_HOURS",
  );
  assert.equal(writes.length, 0);
});
test("扣课成功但考勤PATCH失败，按原参数重试会恢复状态而不重复扣课", async () => {
  failPatch = true;
  setMockResults([{data:{profile_id:teacher,hourly_pay:40,pay_currency:"PHP"}},{ data: null }, { data: { remaining_hours: 5 } }]);
  await assert.rejects(
    () => absence.register(req, lesson, { deduct_hours: true, reason: "缺席" }),
    (e) => e.code === "ATTENDANCE_PENDING",
  );
  const transaction = writes.find((w) => w.url.includes("/lesson_transactions")).body[0];
  assert.equal((await absence.get(lessonId)).state, "pending");
  failPatch = false;
  setMockResults([{ data: transaction }]);
  const done = await absence.register(req, lesson, { deduct_hours: true, reason: "缺席" });
  assert.equal(done.status, "no_show");
  assert.equal(writes.filter((w) => w.url.includes("/lesson_transactions")).length, 1);
});
test("补课改期同步原课节课程、老师、时间和时长，不另生成课节", async () => {
  const row = {
    id: makeupId,
    student_id: student,
    original_lesson_id: lessonId,
    makeup_lesson_id: course,
    status: "scheduled",
    duration_min: 90,
  };
  const current = { ...lesson, id: course };
  setMockResults([
    { data: { ...lesson, status: "cancelled" } },
    { data: current },
    { data: { profile_id: teacher, active: true } },
    { data: [] },
    { data: [] },
  ]);
  const future = new Date(Date.now() + 86400000).toISOString();
  const result = await makeup.schedule(req, row, {
    status: "scheduled",
    scheduled_at: future,
    teacher_id: teacher,
    duration_min: 60,
  });
  assert.equal(result.makeup_lesson_id, course);
  assert.equal(result.scheduled_at, future);
  const patches = writes.filter((w) => w.method === "PATCH");
  const classPatch = patches.find((w) => w.url.includes("/lessons?"));
  assert.equal(classPatch.body.course_id, course);
  assert.equal(classPatch.body.duration_min, 60);
  assert.equal(classPatch.body.scheduled_at, future);
  assert.equal(
    writes.some((w) => w.method === "POST" && w.url.includes("/lessons")),
    false,
  );
});
test("新补课排期继承原课程，冲突时不生成正式课", async () => {
  const row = {
    id: makeupId,
    student_id: student,
    original_lesson_id: lessonId,
    makeup_lesson_id: null,
    status: "pending",
    duration_min: 90,
  };
  const future = new Date(Date.now() + 86400000).toISOString();
  setMockResults([
    { data: { ...lesson, status: "cancelled" } },
    { data: { profile_id: teacher, active: true } },
    { data: [{ ...lesson, id: "conflict", scheduled_at: future, status: "scheduled" }] },
  ]);
  await assert.rejects(
    () =>
      makeup.schedule(req, row, { status: "scheduled", scheduled_at: future, teacher_id: teacher }),
    (e) => e.code === "SCHEDULE_CONFLICT",
  );
  assert.equal(writes.length, 0);
  setMockResults([
    { data: { ...lesson, status: "cancelled" } },
    { data: { profile_id: teacher, active: true } },
    { data: [] },
    { data: null },
    { data: [] },
  ]);
  const result = await makeup.schedule(req, row, {
    status: "scheduled",
    scheduled_at: future,
    teacher_id: teacher,
  });
  const created = writes.find((w) => w.url.includes("/lessons") && w.method === "POST").body[0];
  assert.equal(created.course_id, course);
  assert.equal(created.duration_min, 90);
  assert.equal(result.makeup_lesson_id, created.id);
});
test("补课课节已改派给其他教师后，原课教师不能再改期或取消", async () => {
  const otherTeacher = "77777777-7777-4777-8777-777777777777";
  const teacherReq = { context: { userId: teacher, role: "teacher" }, reqId: "workflow-qa" };
  const row = {
    id: makeupId,
    student_id: student,
    original_lesson_id: lessonId,
    makeup_lesson_id: course,
    status: "scheduled",
    duration_min: 90,
  };
  setMockResults([
    { data: { ...lesson, status: "cancelled", teacher_id: teacher }, error: null },
    { data: { ...lesson, id: course, status: "scheduled", teacher_id: otherTeacher }, error: null },
    { data: [{ student_id: student }], error: null }, // 原课教师的 courses
    { data: [{ student_id: student }], error: null }, // 原课教师的 lessons
  ]);
  await assert.rejects(
    () =>
      makeup.schedule(teacherReq, row, {
        status: "cancelled",
      }),
    (e) => e.status === 403,
  );
  assert.equal(writes.length, 0);
});

test("补课完课自动关闭补课单，不能手工跳过消课流程标为完成", async () => {
  setMockResults([{ data: [{ id: makeupId, status: "scheduled" }] }]);
  await makeup.syncLesson({ ...lesson, status: "completed" });
  assert.equal(writes[0].body.status, "done");
  setMockResults([{ data: { ...lesson, status: "cancelled" } }, { data: lesson }]);
  await assert.rejects(
    () =>
      makeup.schedule(
        req,
        {
          id: makeupId,
          student_id: student,
          original_lesson_id: lessonId,
          makeup_lesson_id: lessonId,
          status: "scheduled",
        },
        { status: "done" },
      ),
    (e) => e.code === "MAKEUP_COMPLETE_REQUIRED",
  );
});
test("家长补课需求复用原待补课单，只保存希望时间，不直接排课或扣费", async () => {
  const parent = { context: { role: "parent", userId: "parent" }, reqId: "parent-qa" };
  const row = {
    id: makeupId,
    student_id: student,
    original_lesson_id: lessonId,
    status: "pending",
  };
  const input = {
    original_lesson_id: lessonId,
    student_id: student,
    note: "希望周末上午",
    scheduled_at: new Date(Date.now() + 86400000).toISOString(),
  };
  setMockResults([
    { data: { ...lesson, status: "cancelled" } },
    { data: [{ student_id: student }] },
    { data: row },
    { data: { id: student, branch_id: null } },
    { data: [] },
  ]);
  const result = await makeup.create(parent, input);
  assert.equal(result.id, makeupId);
  assert.equal(result.status, "pending");
  assert.equal(result.parent_request.preferred_at, input.scheduled_at);
  assert.equal(writes.length, 0);
  setMockResults([
    { data: { ...lesson, status: "cancelled" } },
    { data: [{ student_id: student }] },
    { data: row },
  ]);
  const repeat = await makeup.create(parent, input);
  assert.equal(repeat.alreadyRequested, true);
  assert.equal(writes.length, 0);
  setMockResults([{ data: { ...lesson, status: "cancelled" } }, { data: [] }]);
  await assert.rejects(
    () => makeup.create(parent, input),
    (e) => e.status === 403,
  );
});
test("课时账单区分购课、缺席消耗、退款、调整，余额取权威视图", async () => {
  setMockResults([
    {
      data: [
        {
          id: "consume",
          reason: "consume",
          delta: -1.5,
          lesson_id: lessonId,
          created_at: "2026-10-01",
          note: "缺席扣课",
        },
        { id: "refund", reason: "refund", delta: -2 },
        { id: "adjust", reason: "adjust", delta: 1 },
      ],
    },
    {
      data: [
        {
          id: "pack",
          total_hours: 10,
          remaining_hours: 8,
          purchased_at: "2026-09-01",
          package_types: { name: "口语课时包" },
        },
      ],
    },
    { data: { remaining_hours: 7.5 } },
    { data: [{ ...lesson, status: "no_show" }] },
  ]);
  const result = await ledger.build(student);
  assert.equal(result.remaining_hours, 7.5);
  assert.equal(result.summary.purchased_hours, 10);
  assert.equal(result.summary.consumed_hours, 1.5);
  assert.equal(result.summary.refunded_hours, 2);
  assert.equal(result.events.find((e) => e.id === "consume").label, "缺席扣课时");
  assert.equal(result.events.length, 4);
});
test("同一课节跨请求互斥，结束后释放锁", async () => {
  let finish, started;
  const gate = new Promise((r) => (finish = r)),
    ready = new Promise((r) => (started = r));
  const first = withLock("lesson-qa", async () => {
    started();
    await gate;
    return "ok";
  });
  await ready;
  await assert.rejects(
    () => withLock("lesson-qa", async () => {}),
    (e) => e.code === "WORKFLOW_BUSY",
  );
  finish();
  assert.equal(await first, "ok");
  assert.equal(await withLock("lesson-qa", async () => 42), 42);
});

test("家长课节详情不暴露教师课酬或未发布反馈", async () => {
  const { applyMiddleware, mustHandler } = require("./helpers.js");
  const handler = require("../routes/lessons.js");
  setMockResults([
    { data: { ...lesson, status: "completed", pay_rate: 100, pay_amount: 150 } },
    { data: { id: "own-link" } },
    { data: { id: "draft-record", content: "未发布内容" } },
    { data: null },
  ]);
  const request = applyMiddleware({
    method: "GET",
    url: `/${lessonId}`,
    testUser: { id: "parent", role: "parent" },
  });
  await mustHandler(handler, request.req, request.res);
  assert.equal(request.captured.statusCode, 200);
  assert.equal(request.captured.body.data.record, null);
  assert.equal(request.captured.body.data.pay_amount, undefined);
  assert.equal(request.captured.body.data.pay_rate, undefined);
});

test("家长首页请假统一生成审批单，再标记课程待审批", async () => {
  const { applyMiddleware, mustHandler } = require("./helpers.js");
  const future = { ...lesson, scheduled_at: new Date(Date.now() + 86400000).toISOString() };
  setMockResults([
    { data: future },
    { data: { id: "parent-row" } },
    { data: { parent_id: "parent-row" } },
    { data: [{ student_id: student }] },
    { data: [{ student_id: student }] },
    { data: future },
    { data: null },
    { data: null },
    { data: { branch_id: null } },
    { data: [] },
  ]);
  const r = applyMiddleware({
    method: "POST",
    url: `/lessons/${lessonId}/leave`,
    body: { reason: "孩子发烧" },
    testUser: { id: teacher, role: "parent" },
  });
  await mustHandler(require("../routes/parent.js"), r.req, r.res);
  assert.equal(r.captured.statusCode, 200);
  assert.equal(r.captured.body.data.leave_status, "pending");
  const create = writes.findIndex((w) => w.method === "POST" && w.url.includes("leave_requests"));
  const mark = writes.findIndex((w) => w.method === "PATCH" && w.url.includes("lessons"));
  assert.ok(create >= 0 && mark > create);
  assert.equal(writes[mark].body.leave_status, "pending");
});
test("请假申请重试复用待审批单并修复课程标记，不生成重复申请", async () => {
  const { applyMiddleware, mustHandler } = require("./helpers.js");
  setMockResults([
    { data: lesson },
    { data: { id: makeupId, student_id: student, status: "pending", reason: "发烧" } },
  ]);
  const r = applyMiddleware({
    method: "POST",
    url: "/",
    body: { student_id: student, lesson_id: lessonId, reason: "发烧" },
    testUser: { id: teacher, role: "admin" },
  });
  await mustHandler(require("../routes/leave.js"), r.req, r.res);
  assert.equal(r.captured.statusCode, 200);
  assert.equal(r.captured.body.data.alreadySubmitted, true);
  assert.equal(
    writes.some((w) => w.method === "POST" && w.url.includes("leave_requests")),
    false,
  );
  assert.equal(writes.find((w) => w.url.includes("lessons")).body.leave_status, "pending");
});
test("待审批请假不能直接登记为缺席并扣课时", async () => {
  const { applyMiddleware, mustHandler } = require("./helpers.js");
  setMockResults([{ data: { ...lesson, leave_status: "pending" } }]);
  const r = applyMiddleware({
    method: "POST",
    url: `/${lessonId}/attendance`,
    body: { result: "no_show", deduct_hours: true, reason: "按约定" },
    testUser: { id: teacher, role: "admin" },
  });
  await mustHandler(require("../routes/lessons.js"), r.req, r.res);
  assert.equal(r.captured.statusCode, 409);
  assert.equal(writes.length, 0);
});
