const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const announcements = require("../routes/announcements.js");
const materials = require("../routes/materials.js");

const A1 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ADMIN = { id: "admin1", role: "admin" };
const PARENT = { id: "p1", role: "parent" };
const TEACHER = { id: "t1", role: "teacher" };
const S1 = "11111111-1111-1111-1111-111111111111";

function stubFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: A1 }]) };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("GET /announcements 按角色过滤 audience", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        { id: "a1", title: "全员通知", audience: null, pinned: false },
        { id: "a2", title: "老师通知", audience: "teacher", pinned: true },
        { id: "a3", title: "家长通知", audience: "parent", pinned: false },
      ],
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({ method: "GET", url: "/", testUser: PARENT });
  await announcements(req, res);
  assert.equal(captured.statusCode, 200);
  const titles = captured.body.data.items.map((i) => i.title);
  assert.deepEqual(titles, ["全员通知", "家长通知"]);
});

test("POST /announcements 非 admin 被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "x", body: "y" },
    testUser: PARENT,
  });
  await announcements(req, res);
  assert.equal(captured.statusCode, 403);
});

test("POST /announcements admin 发布走 insert", async () => {
  resetMock();
  setMockResults([
    { data: { id: A1, title: "停课通知", body: "台风停课", audience: null }, error: null },
    { data: null, error: null }, // audit
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "停课通知", body: "台风停课" },
    testUser: ADMIN,
  });
  await announcements(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.title, "停课通知");
});

test("PATCH /announcements/:id 走 raw PostgREST", async () => {
  resetMock();
  const f = stubFetch();
  try {
    setMockResults([{ data: null, error: null }]); // audit
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${A1}`,
      body: { pinned: true },
      testUser: ADMIN,
    });
    await announcements(req, res);
    assert.equal(captured.statusCode, 200);
    assert.ok(f.calls[0].url.includes("/announcements?id=eq."));
    assert.equal(f.calls[0].init.method, "PATCH");
  } finally {
    f.restore();
  }
});

test("DELETE /announcements/:id 家长无权", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "DELETE",
    url: `/${A1}`,
    testUser: PARENT,
  });
  await announcements(req, res);
  assert.equal(captured.statusCode, 403);
});

test("GET /materials 家长只看通用 + 自己孩子的教材", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        { id: "m1", title: "通用课件", student_id: null, kind: "link", url: "https://x" },
        { id: "m2", title: "专属作业", student_id: S1, kind: "text", content: "abc" },
        {
          id: "m3",
          title: "别人的",
          student_id: "22222222-2222-2222-2222-222222222222",
          kind: "link",
          url: "https://y",
        },
      ],
      error: null,
    },
    { data: [{ student_id: S1 }], error: null }, // parent links
    { data: [{ id: S1, full_name: "小明" }], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({ method: "GET", url: "/", testUser: PARENT });
  await materials(req, res);
  assert.equal(captured.statusCode, 200);
  const titles = captured.body.data.items.map((i) => i.title);
  assert.deepEqual(titles, ["通用课件", "专属作业"]);
  assert.equal(captured.body.data.items[1].student_name, "小明");
});

test("GET /materials 教师只看通用教材和自己可见学员的定向教材", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        { id: "m1", title: "通用课件", student_id: null, kind: "link", url: "https://x" },
        { id: "m2", title: "我的学员作业", student_id: S1, kind: "text", content: "abc" },
        {
          id: "m3",
          title: "其他学员作业",
          student_id: "22222222-2222-2222-2222-222222222222",
          kind: "link",
          url: "https://y",
        },
      ],
      error: null,
    },
    { data: [{ student_id: S1 }], error: null },
    { data: [], error: null },
    { data: [{ id: S1, full_name: "小明" }], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({ method: "GET", url: "/", testUser: TEACHER });
  await materials(req, res);
  assert.equal(captured.statusCode, 200);
  assert.deepEqual(
    captured.body.data.items.map((i) => i.title),
    ["通用课件", "我的学员作业"],
  );
  assert.equal(captured.body.data.items[1].student_name, "小明");
});

test("POST /materials 类型与内容不匹配 -> 400", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "链接教材", kind: "link" },
    testUser: ADMIN,
  });
  await materials(req, res);
  assert.equal(captured.statusCode, 400);
});

test("POST /materials 老师只读 -> 403", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "课后作业", kind: "file", url: "https://r2/xxx.pdf" },
    testUser: { id: "t1", role: "teacher" },
  });
  await materials(req, res);
  assert.equal(captured.statusCode, 403);
});

test("DELETE /materials/:id 老师只读 -> 403", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "DELETE",
    url: `/${A1}`,
    testUser: { id: "t1", role: "teacher" },
  });
  await materials(req, res);
  assert.equal(captured.statusCode, 403);
});

test("POST /materials admin 可发布", async () => {
  resetMock();
  setMockResults([
    { data: { id: "m9", title: "课后作业", kind: "file", url: "https://r2/xxx.pdf" }, error: null },
    { data: null, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { title: "课后作业", kind: "file", url: "https://r2/xxx.pdf" },
    testUser: ADMIN,
  });
  await materials(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.url, "https://r2/xxx.pdf");
});
