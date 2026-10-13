// 家长给「学校」留言: school-thread 双向聚合 + 进入即已读; school fan-out 发送。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const messages = withErrorHandler(require("../routes/messages.js"));

const PARENT = { id: "11111111-1111-1111-1111-111111111111", role: "parent", full_name: "P" };
const TEACHER = { id: "22222222-2222-2222-2222-222222222222", role: "teacher", full_name: "T" };
const ADMIN_ID = "33333333-3333-3333-3333-333333333333";
const BR = "00000000-0000-0000-0000-000000000001";

// lib/rest.js 走 raw fetch; mock 它 (supabase-js 已被 setup 整体替换, 不会碰 fetch)。
function mockFetch() {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    const text =
      opts.method === "PATCH"
        ? "" // 标记已读用 return=minimal
        : JSON.stringify([{ id: "m1" }]); // restInsert 的 representation
    return { ok: true, status: 200, text: async () => text };
  };
  return { calls, restore: () => (global.fetch = orig) };
}

function call(user, method, path, body) {
  const { req, res, captured } = applyMiddleware({
    method,
    url: path,
    body,
    headers: { authorization: "Bearer fake" },
    testUser: user,
  });
  return { messages: messages(req, res), captured };
}

test("school-thread: 双向聚合并按时间排序, 学校未读消息进入即标记已读", async () => {
  setMockResults([
    { data: { branch_id: BR }, error: null }, // 我自己
    { data: [{ id: ADMIN_ID, full_name: "管理员" }], error: null }, // 学校 admin
    {
      data: [
        {
          id: "s1",
          to_user: ADMIN_ID,
          from_user: PARENT.id,
          body: "我发的",
          read_at: null,
          created_at: "2026-10-04T10:00:00Z",
        },
      ],
      error: null,
    }, // 我 -> 学校
    {
      data: [
        {
          id: "r1",
          to_user: PARENT.id,
          from_user: ADMIN_ID,
          body: "学校回复",
          read_at: null,
          created_at: "2026-10-04T11:00:00Z",
        },
      ],
      error: null,
    }, // 学校 -> 我
  ]);
  const f = mockFetch();
  try {
    const { messages: p, captured } = await call(PARENT, "GET", "/school-thread");
    await p;
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.admins.length, 1);
    const ms = captured.body.data.messages;
    assert.equal(ms.length, 2);
    assert.equal(ms[0].body, "我发的");
    assert.equal(ms[0].mine, true);
    assert.equal(ms[1].body, "学校回复");
    assert.equal(ms[1].mine, false);
    // 确实发了一条批量 PATCH, 且过滤带上 to_user 作为第二重保险
    const patch = f.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "应发出标记已读 PATCH");
    assert.match(patch.url, /id=in\.\(r1\)/);
    assert.match(patch.url, new RegExp(`to_user=eq.${PARENT.id}`));
  } finally {
    f.restore();
    resetMock();
  }
});

test("school: 家长发送给学校, fan-out 到 admin 并返回 delivered", async () => {
  setMockResults([
    { data: { branch_id: BR }, error: null },
    { data: [{ id: ADMIN_ID, full_name: "管理员" }], error: null },
  ]);
  const f = mockFetch();
  try {
    const { messages: p, captured } = await call(PARENT, "POST", "/school", {
      body: "想问下课时安排",
    });
    await p;
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.delivered, 1);
    // 写入 internal_messages 的 POST, to_user 为 admin, from_user 为家长
    const insert = f.calls.find((c) => c.url.includes("/rest/v1/internal_messages"));
    assert.ok(insert, "应写入 internal_messages");
    const rows = JSON.parse(insert.body);
    assert.equal(rows[0].to_user, ADMIN_ID);
    assert.equal(rows[0].from_user, PARENT.id);
    assert.equal(rows[0].body, "想问下课时安排");
  } finally {
    f.restore();
    resetMock();
  }
});

test("school: 学校没有 admin 时返回 400", async () => {
  setMockResults([
    { data: { branch_id: BR }, error: null },
    { data: [], error: null },
  ]);
  const f = mockFetch();
  try {
    const { messages: p, captured } = await call(PARENT, "POST", "/school", { body: "你好" });
    await p;
    assert.equal(captured.statusCode, 400);
  } finally {
    f.restore();
    resetMock();
  }
});

test("school-thread: 管理员走专用沟通页，聚合学校线程拒绝管理员", async () => {
  setMockResults([]);
  const f = mockFetch();
  try {
    const { messages: p, captured } = await call(
      { id: ADMIN_ID, role: "admin" },
      "GET",
      "/school-thread",
    );
    await p;
    assert.equal(captured.statusCode, 403);
    assert.equal(f.calls.length, 0, "不应有任何写请求");
  } finally {
    f.restore();
    resetMock();
  }
});
test("教师可读取本人学校会话，但不能枚举其他联系人", async () => {
  setMockResults([
    { data: { branch_id: BR } },
    { data: [{ id: ADMIN_ID, full_name: "教务" }] },
    { data: [] },
    { data: [] },
  ]);
  const f = mockFetch();
  try {
    const own = await call(TEACHER, "GET", "/school-thread");
    await own.messages;
    assert.equal(own.captured.statusCode, 200);
    assert.deepEqual(own.captured.body.data.messages, []);
    const contacts = await call(TEACHER, "GET", "/teammates");
    await contacts.messages;
    assert.equal(contacts.captured.statusCode, 403);
  } finally {
    f.restore();
    resetMock();
  }
});
