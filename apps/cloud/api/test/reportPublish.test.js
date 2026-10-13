// 报表事后发布 / 取消发布：补建 parent_feed、幂等、老师只能发自己的课。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const handler = require("../routes/reports.js");

const RECORD_ID = "22222222-2222-2222-2222-222222222222";
const STUDENT_ID = "33333333-3333-3333-3333-333333333333";
const TEACHER_ID = "44444444-4444-4444-4444-444444444444";
const ADMIN = { id: "55555555-5555-5555-5555-555555555555", role: "admin" };
const TEACHER = { id: TEACHER_ID, role: "teacher" };

function stubFetch() {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    // restInsert 用 representation；notifications 用 minimal（忽略返回体）
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "new" }]) };
  };
  return { calls, restore: () => (global.fetch = orig) };
}

function call(user, method) {
  const { req, res, captured } = applyMiddleware({
    method,
    url: `/${RECORD_ID}/publish`,
    headers: { authorization: "Bearer fake" },
    testUser: user,
  });
  return { p: handler(req, res), captured };
}

const recRow = {
  id: RECORD_ID,
  content: "Unit 2",
  performance: "发言积极",
  homework: "P10",
  lessons: { id: "l1", student_id: STUDENT_ID, teacher_id: TEACHER_ID },
};

test("POST 发布：补建 parent_feed 并通知家长", async () => {
  setMockResults([
    { data: recRow, error: null }, // records
    { data: null, error: null }, // 无已存在 feed
    { data: [{ parents: { profile_id: "parent-1" } }], error: null }, // parent links
  ]);
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, "POST");
    await p;
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.published, true);
    // 写了 parent_feeds
    const feedPost = f.calls.find((c) => c.url.includes("/rest/v1/parent_feeds"));
    assert.ok(feedPost, "应插入 parent_feeds");
    const payload = JSON.parse(feedPost.body)[0]; // restInsert 体是数组
    assert.equal(payload.student_id, STUDENT_ID);
    assert.match(payload.summary, /Unit 2/);
    // 也写了通知
    assert.ok(f.calls.some((c) => c.url.includes("/rest/v1/notifications")));
  } finally {
    f.restore();
    resetMock();
  }
});

test("POST 发布幂等：已有 feed 时不再插入、不重复通知", async () => {
  setMockResults([
    { data: recRow, error: null },
    { data: { id: "existing-feed" }, error: null }, // 已发布
  ]);
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, "POST");
    await p;
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.idempotent, true);
    assert.equal(f.calls.length, 0, "幂等命中不应有写请求");
  } finally {
    f.restore();
    resetMock();
  }
});

test("POST 老师只能发布自己课程的反馈", async () => {
  setMockResults([
    { data: { ...recRow, lessons: { ...recRow.lessons, teacher_id: "someone-else" } } },
  ]);
  const f = stubFetch();
  try {
    const { p, captured } = call(TEACHER, "POST");
    await p;
    assert.equal(captured.statusCode, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
    resetMock();
  }
});

test("DELETE 取消发布：删除 parent_feed、保留反馈记录", async () => {
  const f = stubFetch();
  try {
    const { p, captured } = call(ADMIN, "DELETE");
    await p;
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.published, false);
    const del = f.calls.find((c) => c.url.includes("/rest/v1/parent_feeds"));
    assert.ok(del && del.method === "DELETE");
  } finally {
    f.restore();
    resetMock();
  }
});
