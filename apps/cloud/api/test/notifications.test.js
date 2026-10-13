const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock, getQueryLog } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const handler = require("../routes/notifications.js");

const NOTIFICATIONS = [
  {
    id: "n1",
    type: "system",
    title: "全员通知",
    target_user: null,
    target_role: null,
    created_at: "2026-09-19T00:00:00Z",
  },
  {
    id: "n2",
    type: "renewal",
    title: "老师可见",
    target_user: null,
    target_role: "teacher",
    created_at: "2026-09-18T00:00:00Z",
  },
  {
    id: "n3",
    type: "renewal",
    title: "定向给别人",
    target_user: "other-user",
    target_role: null,
    created_at: "2026-09-17T00:00:00Z",
  },
  {
    id: "n4",
    type: "leave",
    title: "家长可见",
    target_user: null,
    target_role: "parent",
    created_at: "2026-09-16T00:00:00Z",
  },
];

test("GET /notifications 按 target_user / target_role 过滤可见性", async () => {
  resetMock();
  // 第一次查询 notifications, 第二次查询已读集合
  setMockResults([
    { data: NOTIFICATIONS, error: null },
    { data: [{ notification_id: "n1" }], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/",
    testUser: { id: "u1", role: "teacher" },
  });
  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  const { items, unread } = captured.body.data;
  assert.deepEqual(
    items.map((i) => i.id),
    ["n1", "n2"],
  );
  assert.equal(items[0].read, true, "n1 已读");
  assert.equal(items[1].read, false, "n2 未读");
  assert.equal(unread, 1);
});

test("GET /notifications 全员通知对所有角色可见", async () => {
  resetMock();
  setMockResults([
    { data: NOTIFICATIONS, error: null },
    { data: [], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/",
    testUser: { id: "u2", role: "parent" },
  });
  await handler(req, res);
  const { items, unread } = captured.body.data;
  assert.deepEqual(
    items.map((i) => i.id),
    ["n1", "n4"],
  );
  assert.equal(unread, 2);
});

test("POST /notifications/read 只标记自己可见且未读的", async () => {
  resetMock();
  setMockResults([
    { data: NOTIFICATIONS, error: null },
    { data: [{ notification_id: "n1" }], error: null },
  ]);

  const originalFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    posted = { url: String(url), opts };
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const { req, res, captured } = applyMiddleware({
      method: "POST",
      url: "/read",
      body: {},
      testUser: { id: "u1", role: "teacher" },
    });
    await handler(req, res);
    assert.equal(captured.statusCode, 200);
    // 可见的是 n1/n2, n1 已读 → 只应新标 n2
    assert.equal(captured.body.data.updated, 1);
    assert.ok(posted, "应调用 raw PostgREST 写入");
    assert.ok(posted.url.includes("notification_reads"));
    assert.deepEqual(JSON.parse(posted.opts.body), [{ user_id: "u1", notification_id: "n2" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("通知可见性条件下推到数据库，不再先取全站最新 200 条", async () => {
  resetMock();
  const own = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "system",
    title: "本人定向",
    target_user: "u1",
    target_role: null,
    created_at: "2026-09-15T00:00:00Z",
  };
  const others = Array.from({ length: 500 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
    type: "system",
    title: `他人通知 ${index}`,
    target_user: "other-user",
    target_role: null,
    created_at: `2026-09-${String(20 + (index % 10)).padStart(2, "0")}T00:00:00Z`,
  }));
  setMockResults([
    { data: others, error: null },
    { data: [own], error: null },
    { data: [], error: null },
  ]);

  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/?limit=50",
    testUser: { id: "u1", role: "teacher" },
  });
  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.body.data.items.map((i) => i.id), [own.id]);
  assert.equal(captured.body.data.unreadTotal, 1);
  const notificationQueries = getQueryLog().filter((q) => q.table === "notifications");
  assert.equal(notificationQueries.length, 2, "应拉取第一页和第二页");
  const notificationQuery = notificationQueries[0];
  const orFilter = notificationQuery.ops.find((op) => op.op === "or");
  assert.ok(orFilter, "必须把 target_user/target_role/全员条件下推给数据库");
  assert.match(orFilter.args[0], /target_user\.eq\.u1/);
  assert.match(orFilter.args[0], /target_role\.eq\.teacher/);
  assert.match(orFilter.args[0], /target_user\.is\.null/);
  const ranges = notificationQueries.flatMap((q) =>
    q.ops.filter((op) => op.op === "range").map((op) => op.args),
  );
  assert.deepEqual(ranges, [[0, 499], [500, 999]], "第一页未命中时必须继续查询第二页");
});

test("全部已读会继续翻页并只标记当前用户可见通知", async () => {
  resetMock();
  const ownOlder = {
    id: "00000000-0000-0000-0000-000000000002",
    type: "system",
    title: "本人旧通知",
    target_user: "u1",
    target_role: null,
    created_at: "2026-09-14T00:00:00Z",
  };
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    id: `11111111-1111-1111-1111-${String(index + 10).padStart(12, "0")}`,
    type: "system",
    title: `他人通知 ${index}`,
    target_user: "other-user",
    target_role: null,
    created_at: "2026-09-20T00:00:00Z",
  }));
  setMockResults([
    { data: firstPage, error: null },
    { data: [ownOlder], error: null },
    { data: [], error: null },
  ]);

  const originalFetch = globalThis.fetch;
  let postedBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("notification_reads")) postedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const { req, res, captured } = applyMiddleware({
      method: "POST",
      url: "/read",
      body: {},
      testUser: { id: "u1", role: "teacher" },
    });
    await handler(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.updated, 1);
    assert.deepEqual(postedBody, [{ user_id: "u1", notification_id: ownOlder.id }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /notifications 非 admin 被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "hi", body: "x" },
    testUser: { id: "u1", role: "teacher" },
  });
  await assert.rejects(() => handler(req, res));
  assert.equal(captured.statusCode, 403);
});
