// 点名接口：请假（不扣课时、登记 leave_requests、生成补课单、通知家长）、缺席、权限。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const handler = require("../routes/lessons.js");

const LESSON_ID = "22222222-2222-2222-2222-222222222222";
const STUDENT_ID = "33333333-3333-3333-3333-333333333333";
const TEACHER_ID = "44444444-4444-4444-4444-444444444444";
const ADMIN = { id: "55555555-5555-5555-5555-555555555555", role: "admin" };
const TEACHER = { id: TEACHER_ID, role: "teacher" };
const PARENT = { id: "66666666-6666-6666-6666-666666666666", role: "parent" };

// ⚠️ 后端已去掉 return=minimal（该模式 PostgREST 返回空 body → restPatch 恒为 []
// → 无法校验行数 → 把「0 行更新」当成功）。所以 mock 必须返回行数组。
function stubFetch({ rowFor = () => [{ id: "x" }] } = {}) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || "GET";
    calls.push({ url: u, method, body: opts.body });
    return { ok: true, status: 200, text: async () => JSON.stringify(rowFor(u, method) || []) };
  };
  return { calls, restore: () => (global.fetch = orig) };
}

function call(user, body) {
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LESSON_ID}/attendance`,
    body,
    headers: { authorization: "Bearer fake" },
    testUser: user,
  });
  return { p: mustHandler(handler, req, res), captured };
}

const lesson = {
  duration_min:60, scheduled_at:"2026-10-01T01:00:00Z",
  id: LESSON_ID,
  student_id: STUDENT_ID,
  teacher_id: TEACHER_ID,
  status: "scheduled",
  duration_min: 60,
};

test("请假：课变 cancelled+approved+原因，不扣课时，写 leave_requests", async () => {
  // 查询顺序：lesson → 无 pending request → makeups 去重查询
  setMockResults([
    { data: { ...lesson, scheduled_at: new Date(Date.now()+24*3600000).toISOString() }, error: null }, // lesson
    { data: null, error: null }, // 无 pending request
    { data: null, error: null }, // 无既有补课单
    { data: [], error: null }, // 通知时查 parent_student_links
    { data: null, error: null }, // 通知时查 students.wecom_external_user_id
  ]);
  const f = stubFetch({
    rowFor: (u) => (u.includes("/rest/v1/leave_requests") ? [{ id: "lr-1" }] : [{ id: "x" }]),
  });
  try {
    const { p, captured } = call(ADMIN, { result: "leave", reason: "孩子发烧" });
    await p;
    assert.equal(captured.statusCode, 200);

    // lesson PATCH
    const lessonPatch = f.calls.find(
      (c) => c.url.includes("/rest/v1/lessons") && c.method === "PATCH",
    );
    assert.ok(lessonPatch);
    const payload = JSON.parse(lessonPatch.body);
    assert.equal(payload.status, "cancelled");
    assert.equal(payload.leave_status, "approved");
    assert.equal(payload.leave_reason, "孩子发烧");

    // 写了 leave_requests（POST）
    const lrPost = f.calls.find((c) => c.url.includes("/rest/v1/leave_requests"));
    assert.ok(lrPost, "应登记 leave_requests");
    const row = JSON.parse(lrPost.body)[0];
    assert.equal(row.status, "approved");
    assert.equal(row.reason, "孩子发烧");

    // 没有写扣课时流水
    assert.ok(!f.calls.some((c) => c.url.includes("/rest/v1/lesson_transactions")));
  } finally {
    f.restore();
    resetMock();
  }
});

test("请假：必须生成补课单（缺这一步课时凭空少且无人安排补课）", async () => {
  setMockResults([
    { data: { ...lesson, scheduled_at: new Date(Date.now()+24*3600000).toISOString() }, error: null },
    { data: null, error: null }, // 无 pending
    { data: null, error: null }, // 无既有补课单
    { data: [], error: null }, // parent_student_links
    { data: null, error: null }, // students
  ]);
  const f = stubFetch({
    rowFor: (u) => (u.includes("/rest/v1/leave_requests") ? [{ id: "lr-1" }] : [{ id: "x" }]),
  });
  try {
    const { p } = call(ADMIN, { result: "leave", reason: "发烧" });
    await p;

    const mk = f.calls.find((c) => c.url.includes("/rest/v1/makeups") && c.method === "POST");
    assert.ok(mk, "必须创建补课单（与 leave.js 的 reviewLeave 同一终态语义）");
    const payload = JSON.parse(mk.body)[0];
    assert.equal(payload.status, "pending");
    assert.equal(payload.original_lesson_id, LESSON_ID);
    assert.equal(payload.leave_request_id, "lr-1");
    assert.equal(payload.duration_min, 60, "补课时长应继承原课节");
  } finally {
    f.restore();
    resetMock();
  }
});

test("请假：通知家长（否则家长完全不知情）", async () => {
  setMockResults([
    { data: { ...lesson, scheduled_at: new Date(Date.now()+24*3600000).toISOString() }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [{ parents: { profile_id: "p-1" } }], error: null }, // 有家长
    { data: null, error: null },
  ]);
  const f = stubFetch({
    rowFor: (u) => (u.includes("/rest/v1/leave_requests") ? [{ id: "lr-1" }] : [{ id: "x" }]),
  });
  try {
    const { p } = call(ADMIN, { result: "leave", reason: "发烧" });
    await p;

    const note = f.calls.find((c) => c.url.includes("/rest/v1/notifications") && c.method === "POST");
    assert.ok(note, "应给家长发站内通知");
    const rows = JSON.parse(note.body);
    assert.equal(rows[0].target_user, "p-1");
    assert.equal(rows[0].student_id, STUDENT_ID);
  } finally {
    f.restore();
    resetMock();
  }
});

test("写入顺序：先 leave_requests 再 lessons（否则失败时不可回滚）", async () => {
  setMockResults([
    { data: { ...lesson, scheduled_at: new Date(Date.now()+24*3600000).toISOString() }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: null, error: null },
  ]);
  const f = stubFetch({
    rowFor: (u) => (u.includes("/rest/v1/leave_requests") ? [{ id: "lr-1" }] : [{ id: "x" }]),
  });
  try {
    const { p } = call(ADMIN, { result: "leave", reason: "发烧" });
    await p;

    const lrIdx = f.calls.findIndex((c) => c.url.includes("/rest/v1/leave_requests"));
    const lessonIdx = f.calls.findIndex(
      (c) => c.url.includes("/rest/v1/lessons") && c.method === "PATCH",
    );
    assert.ok(lrIdx >= 0 && lessonIdx >= 0);
    assert.ok(
      lrIdx < lessonIdx,
      "leave_requests 必须先写：否则 lessons 改成功后第二步失败，课节已 cancelled 却无请假单",
    );
  } finally {
    f.restore();
    resetMock();
  }
});

test("缺席：标记 no_show，不扣课时", async () => {
  globalThis.__CLOUDFLARE_ENV={BACKUP_BUCKET:new (require('./support/statefulDb.js').Bucket)(),ENCRYPTION_KEY:Buffer.alloc(32,18).toString('base64'),SUPABASE_URL:'https://attendance.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock'};
  setMockResults([
    { data: lesson, error: null },
    {data:{profile_id:TEACHER_ID,hourly_pay:40,pay_currency:"PHP"},error:null},
    { data: [], error: null }, // parent_student_links
    { data: null, error: null }, // students
  ]);
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, { result: "no_show" });
    await p;
    assert.equal(captured.statusCode, 200);
    const patch = f.calls.find((c) => c.url.includes("/rest/v1/lessons"));
    assert.equal(JSON.parse(patch.body).status, "no_show");
    assert.ok(!f.calls.some((c) => c.url.includes("lesson_transactions")));
  } finally {
    f.restore();
    resetMock();
    delete globalThis.__CLOUDFLARE_ENV;
  }
});

test("缺席：0 行更新必须报错，不能假成功", async () => {
  globalThis.__CLOUDFLARE_ENV={BACKUP_BUCKET:new (require('./support/statefulDb.js').Bucket)(),ENCRYPTION_KEY:Buffer.alloc(32,18).toString('base64'),SUPABASE_URL:'https://attendance.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock'};
  setMockResults([
    { data: lesson, error: null },
    {data:{profile_id:TEACHER_ID,hourly_pay:40,pay_currency:"PHP"},error:null},
    { data: [], error: null },
    { data: null, error: null },
  ]);
  // PATCH 返回空数组 = 命中 0 行
  const f = stubFetch({ rowFor: () => [] });
  try {
    const { p, captured } = call(ADMIN, { result: "no_show" });
    await p;
    assert.notEqual(captured.statusCode, 200, "命中 0 行不能返 200（PostgREST PATCH 的假成功陷阱）");
    assert.equal(captured.statusCode, 503);
    assert.equal(captured.body.code,"ATTENDANCE_PENDING");
  } finally {
    f.restore();
    resetMock();
    delete globalThis.__CLOUDFLARE_ENV;
  }
});

test("请假缺原因 → 400", async () => {
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, { result: "leave" });
    await p;
    assert.equal(captured.statusCode, 400);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test("老师只能给自己的课点名", async () => {
  setMockResults([{ data: { ...lesson, teacher_id: "someone-else" }, error: null }]);
  const f = stubFetch();
  try {
    const { p, captured } = call(TEACHER, { result: "no_show" });
    await p;
    assert.equal(captured.statusCode, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
    resetMock();
  }
});

test("家长不能点名", async () => {
  const f = stubFetch();
  try {
    const { p, captured } = call(PARENT, { result: "no_show" });
    await p;
    assert.equal(captured.statusCode, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test("已点名的课不能重复操作", async () => {
  setMockResults([{ data: { ...lesson, status: "cancelled" }, error: null }]);
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, { result: "no_show" });
    await p;
    assert.equal(captured.statusCode, 409);
  } finally {
    f.restore();
    resetMock();
  }
});

test("畸形 body（非法 JSON）应 400 而不是 500", async () => {
  // src/worker.js 在 JSON.parse 失败时会把原始字符串塞回 req.body，
  // 所以 string 分支是真实可达路径 —— 裸 JSON.parse 会抛 SyntaxError 变 500。
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: `/${LESSON_ID}/attendance`,
    body: "{",
    headers: { authorization: "Bearer fake" },
    testUser: ADMIN,
  });
  try {
    await mustHandler(handler, req, res);
    assert.equal(captured.statusCode, 400, "畸形 JSON 应报 400 参数不合法");
  } finally {
    resetMock();
  }
});