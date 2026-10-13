// 守卫: 招生线索的「意向课程 / 期望试听日期」两个字段。
//
// 背景: /recruit 报名表单只收了方便联系时间, 教务回电时每次都要再问一遍
// 「孩子想上什么课」「希望哪天来试听」。v6 迁移给 leads 加了 intended_course / trial_date。
//
// 这里守住两件事:
//   ① 校验: 日期必须是 YYYY-MM-DD 且不早于今天（否则家长随便填个 2020 年也进库）
//   ② 降级: 万一 SQL 迁移还没跑、Worker 先部署了, 公开报名页不能 500 ——
//      PostgREST 报 "Could not find the 'trial_date' column" 时要丢掉新字段重试。
//      这条最重要: 招生入口是给陌生人填的, 挂了就是直接丢客。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const leads = withErrorHandler(require("../routes/leads.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };

// 迁移没跑时 PostgREST 的真实报错形态
const MISSING_COL = {
  message: "Could not find the 'trial_date' column of 'leads' in the schema cache",
  code: "42703",
  details: null,
  hint: null,
};

function stubFetch() {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", init });
    return { ok: true, status: 200, text: async () => "[]" };
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

// 用真实时间算, 别硬编码日期 —— 否则脚本明年就红了
function futureDate(offsetDays = 3) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
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
  "POST /leads 接受意向课程与期望试听日期, 并写进管理员通知",
  withEnv(async () => {
    setMockResults([{ data: { id: "lead-1", status: "new" }, error: null }]);
    const f = stubFetch();
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: "/",
        body: {
          parent_name: "李妈妈",
          parent_phone: "13900000000",
          child_name: "小美",
          child_age: 9,
          intended_course: "自然拼读",
          trial_date: futureDate(3),
        },
      });
      await leads(req, res);
      assert.equal(res._captured.statusCode, 200);

      const post = f.calls.find((c) => c.method === "POST" && c.url.includes("/notifications"));
      assert.ok(post, "应发出通知");
      const rows = JSON.parse(post.init.body);
      assert.match(rows[0].body, /自然拼读/, "通知正文要带意向课程, 管理员才知道怎么安排");
      assert.match(rows[0].body, /试听/, "通知正文要带期望试听日期");
    } finally {
      f.restore();
    }
  }),
);

test(
  "POST /leads 拒绝过去的试听日期",
  withEnv(async () => {
    const f = stubFetch();
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: "/",
        body: {
          parent_name: "李妈妈",
          parent_phone: "13900000000",
          trial_date: "2020-01-01",
        },
      });
      await leads(req, res);
      assert.equal(res._captured.statusCode, 400, "过去的日期必须拒绝");
    } finally {
      f.restore();
    }
  }),
);

test(
  "POST /leads 缺列时降级重试, 公开报名页不 500",
  withEnv(async () => {
    setMockResults([
      { data: null, error: MISSING_COL },
      { data: { id: "lead-2", status: "new" }, error: null },
    ]);
    const f = stubFetch();
    try {
      const { req, res } = applyMiddleware({
        method: "POST",
        url: "/",
        body: {
          parent_name: "王妈妈",
          parent_phone: "13700000000",
          intended_course: "剑桥备考",
          trial_date: futureDate(1),
        },
      });
      await leads(req, res);
      assert.equal(res._captured.statusCode, 200, "迁移没跑也要让家长报上名");
      assert.equal(res._captured.body.data.id, "lead-2", "必须真的走了第二次重试插入");
    } finally {
      f.restore();
    }
  }),
);

test(
  "GET /leads 缺列时退回旧字段集, 线索列表不 500",
  withEnv(async () => {
    setMockResults([
      { data: null, error: MISSING_COL },
      { data: [{ id: "lead-3" }], error: null },
    ]);
    const f = stubFetch();
    try {
      const { req, res } = applyMiddleware({
        method: "GET",
        url: "/",
        headers: { authorization: "Bearer fake" },
        testUser: ADMIN,
      });
      await leads(req, res);
      assert.equal(res._captured.statusCode, 200);
      assert.equal(res._captured.body.data.length, 1);
    } finally {
      f.restore();
    }
  }),
);
