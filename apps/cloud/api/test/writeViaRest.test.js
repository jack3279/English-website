// 回归守卫: routes 的写操作必须走 raw PostgREST (lib/rest.js)。
// 背景: supabase-js 的 .update()/.delete() 在 Cloudflare Workers 上会静默 no-op ——
// 表现是接口返回 200、前端提示成功, 但数据没变。这类回归在单测里只能靠「断言真的发出了
// PATCH/DELETE fetch」来拦住, 因此本文件逐个锁定改造过的写入路径。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const leads = withErrorHandler(require("../routes/leads.js"));
const packages = withErrorHandler(require("../routes/packages.js"));
const lessons = withErrorHandler(require("../routes/lessons.js"));

const ADMIN = {
  id: "00000000-0000-0000-0000-000000000001",
  role: "admin",
  full_name: "Admin",
  branch_id: "b-1",
};
const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const TYPE_ID = "22222222-2222-2222-2222-222222222222";
const LESSON_ID = "33333333-3333-3333-3333-333333333333";

function authHeader(user) {
  return { authorization: `Bearer fake-jwt-${user.id}` };
}

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

test.afterEach(() => resetMock());

test("PATCH /leads/:id 走 raw PATCH", async () => {
  resetMock();
  const f = stubFetch([{ id: LEAD_ID, status: "contacted" }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LEAD_ID}`,
      headers: authHeader(ADMIN),
      body: { status: "contacted" },
      testUser: ADMIN,
    });
    await leads(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.status, "contacted");
    assert.ok(f.calls[0].url.includes(`/leads?id=eq.${LEAD_ID}`));
    assert.equal(f.calls[0].init.method, "PATCH");
    assert.equal(JSON.parse(f.calls[0].init.body).status, "contacted");
  } finally {
    f.restore();
  }
});

test("PATCH /leads/:id 找不到时报 404", async () => {
  resetMock();
  const f = stubFetch([]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LEAD_ID}`,
      headers: authHeader(ADMIN),
      body: { status: "lost" },
      testUser: ADMIN,
    });
    await leads(req, res);
    assert.equal(captured.statusCode, 404);
  } finally {
    f.restore();
  }
});

test("PATCH /packages/types/:id 走 raw PATCH", async () => {
  resetMock();
  const f = stubFetch([{ id: TYPE_ID, name: "20 课时" }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/types/${TYPE_ID}`,
      headers: authHeader(ADMIN),
      body: { name: "20 课时" },
      testUser: ADMIN,
    });
    await packages(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.name, "20 课时");
    assert.ok(f.calls[0].url.includes(`/package_types?id=eq.${TYPE_ID}`));
    assert.equal(f.calls[0].init.method, "PATCH");
  } finally {
    f.restore();
  }
});

test("DELETE /packages/types/:id 走 raw DELETE", async () => {
  resetMock();
  const f = stubFetch([{ id: TYPE_ID }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "DELETE",
      url: `/types/${TYPE_ID}`,
      headers: authHeader(ADMIN),
      testUser: ADMIN,
    });
    await packages(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.deleted, true);
    assert.ok(f.calls[0].url.includes(`/package_types?id=eq.${TYPE_ID}`));
    assert.equal(f.calls[0].init.method, "DELETE");
  } finally {
    f.restore();
  }
});

test("PATCH /lessons/:id 改期走 raw PATCH", async () => {
  resetMock();
  const newTime = "2026-09-25T10:00:00.000Z";
  setMockResults([
    // cur：需含 status/关系字段（reschedule 现在会校验 status、查冲突、发通知）
    {
      data: {
        id: LESSON_ID,
        teacher_id: "t1",
        student_id: "s1",
        duration_min: 60,
        status: "scheduled",
        scheduled_at: "2026-09-25T08:00:00.000Z",
        students: { full_name: "小明" },
        profiles: { full_name: "Emma" },
      },
      error: null,
    },
    { data: [], error: null }, // 附近课节（无冲突）
  ]);
  const f = stubFetch([{ id: LESSON_ID, scheduled_at: newTime }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: newTime },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.scheduled_at, newTime);
    assert.ok(f.calls[0].url.includes(`/lessons?id=eq.${LESSON_ID}`));
    assert.equal(f.calls[0].init.method, "PATCH");
    assert.equal(JSON.parse(f.calls[0].init.body).scheduled_at, newTime);
  } finally {
    f.restore();
  }
});

test("PATCH /lessons/:id 命中 0 行必须报错（假成功防护）", async () => {
  resetMock();
  const newTime = "2026-09-25T10:00:00.000Z";
  setMockResults([
    {
      data: {
        id: LESSON_ID,
        teacher_id: "t1",
        student_id: "s1",
        duration_min: 60,
        status: "scheduled",
        scheduled_at: "2026-09-25T08:00:00.000Z",
        students: { full_name: "小明" },
        profiles: { full_name: "Emma" },
      },
      error: null,
    },
    { data: [], error: null },
  ]);
  // PATCH 返回空数组 = 命中 0 行：PostgREST 仍会给 200
  const f = stubFetch([]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: newTime },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 404, "命中 0 行不能返 200");
  } finally {
    f.restore();
  }
});

test("PATCH /lessons/:id 已取消的课不能再改期", async () => {
  resetMock();
  setMockResults([
    {
      data: {
        id: LESSON_ID,
        teacher_id: "t1",
        student_id: "s1",
        duration_min: 60,
        status: "cancelled",
        scheduled_at: "2026-09-25T08:00:00.000Z",
      },
      error: null,
    },
  ]);
  const f = stubFetch([]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: "2026-09-25T10:00:00.000Z" },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 409);
  } finally {
    f.restore();
  }
});

test("冲突判定跳过已取消的课（曾导致老师永远拖不动这节课）", async () => {
  resetMock();
  const newTime = "2026-09-25T10:00:00.000Z";
  setMockResults([
    {
      data: {
        id: LESSON_ID,
        teacher_id: "t1",
        student_id: "s1",
        duration_min: 60,
        status: "scheduled",
        scheduled_at: "2026-09-25T08:00:00.000Z",
      },
      error: null,
    },
    // 同一老师同一时段的已取消课节：不算冲突（detect 会 skip）
    {
      data: [
        {
          id: "other",
          teacher_id: "t1",
          student_id: "s9",
          duration_min: 60,
          status: "cancelled",
          scheduled_at: newTime,
        },
      ],
      error: null,
    },
  ]);
  const f = stubFetch([{ id: LESSON_ID, scheduled_at: newTime }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: newTime },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 200, "已取消的课不该阻塞改期");
  } finally {
    f.restore();
  }
});

test("冲突判定按真实时长重叠（曾固定 60 分钟窗口导致长课漏报）", async () => {
  resetMock();
  const newTime = "2026-09-25T10:00:00.000Z";
  setMockResults([
    {
      data: {
        id: LESSON_ID,
        teacher_id: "t1",
        student_id: "s1",
        duration_min: 60,
        status: "scheduled",
        scheduled_at: "2026-09-25T08:00:00.000Z",
      },
      error: null,
    },
    // 目标时间后 30 分钟开始的 120 分钟长课：10:00-11:00 与 10:30-12:30 重叠 → 应报冲突
    // 旧的 ±60 分钟窗口查不到（11:30 那版）或会误判，改用 detect() 才正确
    {
      data: [
        {
          id: "long",
          teacher_id: "t1",
          student_id: "s9",
          duration_min: 120,
          status: "scheduled",
          scheduled_at: "2026-09-25T10:30:00.000Z",
        },
      ],
      error: null,
    },
  ]);
  const f = stubFetch([]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: newTime },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 409, "120 分钟长课重叠必须检出");
  } finally {
    f.restore();
  }
});

test("PATCH /lessons/:id 时间非法 400 且不发出写请求", async () => {
  resetMock();
  setMockResults([{ data: { teacher_id: "t1", student_id: "s1", duration_min: 60 }, error: null }]);
  const f = stubFetch([{ id: LESSON_ID }]);
  try {
    const { req, res, captured } = applyMiddleware({
      method: "PATCH",
      url: `/${LESSON_ID}`,
      headers: authHeader(ADMIN),
      body: { scheduled_at: "not-a-date" },
      testUser: ADMIN,
    });
    await lessons(req, res);
    assert.equal(captured.statusCode, 400);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});
