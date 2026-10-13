// 守卫: 三类「有业务发生但没有通知」的缺口。
//
// 背景: notifications 表建好了、通知中心/铃铛也做好了, 但只有 请假 / 上课提醒 / 管理员手动发布
// 会往里写。以下三件事发生后收件人完全不知道 —— 除非主动去翻对应页面:
//   ① 有人提交试听报名      → 管理员不知道
//   ② 有人发了站内信        → 收件人不知道
//   ③ 老师发布了课堂反馈    → 家长不知道（class_report 类型被前端标成"课堂反馈"却从没产生过）
// 通知是「尽力而为」的, 失败不能影响主流程, 所以这里断言的是「确实发出了 INSERT notifications」。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const leads = withErrorHandler(require("../routes/leads.js"));
const messages = withErrorHandler(require("../routes/messages.js"));
const lessons = withErrorHandler(require("../routes/lessons.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };
const RECIPIENT = "22222222-2222-2222-2222-222222222222";
const LESSON_ID = "11111111-1111-1111-1111-111111111111";

function stubRouter(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const method = init?.method || "GET";
    calls.push({ url: u, method, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(handler(u, method) ?? null) };
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

function notificationCalls(f) {
  return f.calls.filter((c) => c.method === "POST" && c.url.includes("/rest/v1/notifications"));
}

function sentRows(f) {
  const c = notificationCalls(f)[0];
  assert.ok(c, "必须发出 POST /rest/v1/notifications");
  return JSON.parse(c.init.body);
}

// 家长是一批一次 POST(数组), 老师是单独一次 POST —— 要把所有 notifications 写入拍平来看。
function allSentRows(f) {
  const out = [];
  for (const c of notificationCalls(f)) {
    const parsed = JSON.parse(c.init.body);
    out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return out;
}

const withEnv = (fn) => async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  try {
    await fn();
  } finally {
    delete globalThis.__CLOUDFLARE_ENV;
  }
};

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test(
  "POST /leads 报名后广播通知给管理员",
  withEnv(async () => {
    setMockResults([{ data: { id: "lead-1", status: "new" }, error: null }]);
    const f = stubRouter(() => []);
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: "/",
        body: {
          parent_name: "张妈妈",
          parent_phone: "13800000000",
          child_name: "小明",
          child_age: 8,
          preferred_time: "工作日下午",
        },
      });
      await leads(req, res);
      assert.equal(res._captured.statusCode, 200);

      const rows = sentRows(f);
      assert.equal(rows.length, 1, "广播给角色只需一条, 不必一人一条");
      assert.equal(rows[0].target_role, "admin");
      assert.equal(rows[0].type, "lead");
      assert.match(rows[0].title, /试听报名/);
      assert.match(rows[0].body, /张妈妈/);
      assert.match(rows[0].body, /工作日下午/);
    } finally {
      f.restore();
    }
  }),
);

test(
  "POST /messages 发消息后定向通知收件人",
  withEnv(async () => {
    setMockResults([
      { data: { id: RECIPIENT }, error: null }, // 收件人存在
      { data: { id: "m-1", to_user: RECIPIENT, body: "hello" }, error: null }, // insert
    ]);
    const f = stubRouter(() => []);
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: "/",
        headers: { authorization: "Bearer fake" },
        body: { to_user: RECIPIENT, subject: "关于补课", body: "我们改到周六" },
        testUser: ADMIN,
      });
      await messages(req, res);
      assert.equal(res._captured.statusCode, 200);

      const rows = sentRows(f);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].target_user, RECIPIENT, "必须定向到收件人, 不能广播");
      assert.equal(rows[0].type, "message");
      assert.equal(rows[0].title, "关于补课");
      assert.equal(rows[0].link, "/messages");
    } finally {
      f.restore();
    }
  }),
);

test(
  "消课并发布课堂反馈后通知家长",
  withEnv(async () => {
    const LESSON = {
      id: LESSON_ID,
      course_id: "33333333-3333-3333-3333-333333333333",
      teacher_id: "t-1",
      student_id: "44444444-4444-4444-4444-444444444444",
      scheduled_at: "2026-09-20T02:00:00.000Z",
      duration_min: 60,
      status: "scheduled",
    };
    setMockResults([
      { data: null, error: null }, // records 幂等检查
      { data: { id: LESSON.student_id, full_name: "Lily" }, error: null }, // student
      { data: { remaining_hours: 10 }, error: null }, // balance
      { data: { id: "r-1" }, error: null }, // records insert
      { data: null, error: null }, // lesson_transactions insert
      { data: {id:"feed-1"}, error: null }, // parent_feeds insert returned row
      { data: { full_name: "Alice" }, error: null }, // profiles (fetchTeacherName)
      {
        data: [{ parents: { profile_id: "p-1" } }, { parents: { profile_id: "p-2" } }],
        error: null,
      }, // 家长
      { data: null, error: null }, // audit
    ]);
    const f = stubRouter((u, m) => {
      if (m === "GET" && u.includes("/rest/v1/lessons?")) return [LESSON];
      if (m === "GET" && u.includes("/rest/v1/teachers?")) return [{ hourly_pay: 200 }];
      if (m === "PATCH" && u.includes("/rest/v1/lessons?")) return [{ id: LESSON_ID }];
      return [];
    });
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: `/${LESSON_ID}/complete`,
        headers: { authorization: "Bearer fake" },
        body: { content: "Unit 5", publishToParent: true },
        testUser: ADMIN,
      });
      await lessons(req, res);
      assert.equal(res._captured.statusCode, 200);

      const rows = sentRows(f);
      assert.equal(rows.length, 2, "有两个家长就发两条");
      assert.deepEqual(rows.map((r) => r.target_user).sort(), ["p-1", "p-2"]);
      assert.equal(rows[0].type, "class_report");
      assert.match(rows[0].title, /Lily 的课堂反馈/);
    } finally {
      f.restore();
    }
  }),
);

test(
  "不发布课堂反馈时不产生通知（publishToParent=false）",
  withEnv(async () => {
    const LESSON = {
      id: LESSON_ID,
      course_id: "33333333-3333-3333-3333-333333333333",
      teacher_id: "t-1",
      student_id: "44444444-4444-4444-4444-444444444444",
      scheduled_at: "2026-09-20T02:00:00.000Z",
      duration_min: 60,
      status: "scheduled",
    };
    setMockResults([
      { data: null, error: null },
      { data: { id: LESSON.student_id, full_name: "Lily" }, error: null },
      { data: { remaining_hours: 10 }, error: null },
      { data: { id: "r-1" }, error: null },
      { data: null, error: null },
      { data: null, error: null }, // audit
    ]);
    const f = stubRouter((u, m) => {
      if (m === "GET" && u.includes("/rest/v1/lessons?")) return [LESSON];
      if (m === "GET" && u.includes("/rest/v1/teachers?")) return [{ hourly_pay: 200 }];
      if (m === "PATCH" && u.includes("/rest/v1/lessons?")) return [{ id: LESSON_ID }];
      return [];
    });
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: `/${LESSON_ID}/complete`,
        headers: { authorization: "Bearer fake" },
        body: { content: "Unit 5", publishToParent: false },
        testUser: ADMIN,
      });
      await lessons(req, res);
      assert.equal(res._captured.statusCode, 200);
      assert.equal(notificationCalls(f).length, 0, "没发布反馈就不该打扰家长");
    } finally {
      f.restore();
    }
  }),
);

// ---- 2026-09-21 补: 改期 / 取消课节 ----
// 这两件事原本**一个通知都不发**: 家长和老师只能靠自己想起来翻课程表,
// 改期最常见的后果就是有人白跑一趟。排课是最高频的操作之一, 所以单独钉住。
const schedules = withErrorHandler(require("../routes/schedules.js"));

const STUDENT_ID = "33333333-3333-3333-3333-333333333333";
const PARENT_PROFILE = "44444444-4444-4444-4444-444444444444";
const TEACHER_PROFILE = "55555555-5555-5555-5555-555555555555";

// 一个对象同时满足两种查询的形状:
//   lessonWithNames 读 id/student_id/teacher_id/scheduled_at/students/profiles
//   parentProfileIds 读 parents.profile_id
const LESSON_ROW = {
  id: LESSON_ID,
  student_id: STUDENT_ID,
  teacher_id: TEACHER_PROFILE,
  scheduled_at: "2026-09-23T08:00:00.000Z",
  duration_min: 60,
  status: "scheduled",
  students: { full_name: "小明" },
  profiles: { full_name: "Alice 老师" },
  parents: { profile_id: PARENT_PROFILE },
};

test(
  "取消课节会通知家长与老师",
  withEnv(async () => {
    // 队列按真实查询顺序: ① 取课节上下文 ② 取该学员的家长（真实返回是数组）
    setMockResults([
      { data: LESSON_ROW, error: null },
      { data: [{ parents: { profile_id: PARENT_PROFILE } }], error: null },
    ]);
    const f = stubRouter((u) => (u.includes("/rest/v1/lessons") ? [LESSON_ROW] : []));
    try {
      const { req, res } = applyMiddleware({
        method: "DELETE",
        url: `/${LESSON_ID}`,
        headers: { authorization: "Bearer fake" },
        testUser: ADMIN,
      });
      await schedules(req, res);
      assert.equal(res._captured.statusCode, 200);

      const rows = allSentRows(f);
      assert.ok(rows.length >= 2, `家长与老师都该收到, 实际 ${rows.length} 条`);
      assert.ok(rows.every((r) => r.type === "lesson_cancelled"));
      const targets = rows.map((r) => r.target_user);
      assert.ok(targets.includes(PARENT_PROFILE), "家长要收到");
      assert.ok(targets.includes(TEACHER_PROFILE), "老师要收到");
      const toParent = rows.find((r) => r.target_user === PARENT_PROFILE);
      assert.match(toParent.body, /小明/);
      assert.match(toParent.body, /取消/);
    } finally {
      f.restore();
    }
  }),
);

test(
  "改期会通知, 且正文带上原时间与新时间",
  withEnv(async () => {
    setMockResults([
      // 当前课节(current)
      {
        data: { ...LESSON_ROW, scheduled_at: "2026-09-23T08:00:00.000Z" },
        error: null,
      },
      // 冲突检测的 nearby 查询: 没有别的课
      { data: [], error: null },
      // audit_log 写入也走 supabase-js, 同样消耗一次 mock
      { data: null, error: null },
      // lessonWithNames
      { data: { ...LESSON_ROW, scheduled_at: "2026-09-24T09:00:00.000Z" }, error: null },
      // 该学员的家长（真实返回是数组）
      { data: [{ parents: { profile_id: PARENT_PROFILE } }], error: null },
    ]);
    const f = stubRouter((u) => (u.includes("/rest/v1/lessons") ? [LESSON_ROW] : []));
    try {
      const { req, res } = applyMiddleware({
        method: "PATCH",
        url: `/${LESSON_ID}`,
        body: { scheduled_at: "2026-09-24T09:00:00.000Z" },
        headers: { authorization: "Bearer fake" },
        testUser: ADMIN,
      });
      await schedules(req, res);
      assert.equal(res._captured.statusCode, 200);

      const rows = allSentRows(f);
      assert.ok(rows.length > 0, "改期必须发出通知");
      assert.ok(rows.every((r) => r.type === "lesson_rescheduled"));
      const toParent = rows.find((r) => r.target_user === PARENT_PROFILE);
      assert.match(toParent.body, /9\/23/, "要写清原时间");
      assert.match(toParent.body, /9\/24/, "要写清新时间");
    } finally {
      f.restore();
    }
  }),
);

test(
  "只改备注/时长时不打扰家长(避免变成骚扰)",
  withEnv(async () => {
    setMockResults([
      { data: { ...LESSON_ROW }, error: null },
      { data: [], error: null }, // 冲突检测的 nearby 查询: 真实返回是数组
    ]);
    const f = stubRouter((u) => (u.includes("/rest/v1/lessons") ? [LESSON_ROW] : []));
    try {
      const { req, res } = applyMiddleware({
        method: "PATCH",
        url: `/${LESSON_ID}`,
        body: { duration_min: 45 },
        headers: { authorization: "Bearer fake" },
        testUser: ADMIN,
      });
      await schedules(req, res);
      assert.equal(res._captured.statusCode, 200);
      assert.equal(notificationCalls(f).length, 0, "时长变化不该发通知");
    } finally {
      f.restore();
    }
  }),
);
