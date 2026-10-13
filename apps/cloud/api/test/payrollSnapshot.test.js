// 守卫: 消课必须把「课酬单价 + 金额」冻结到课节上（lessons.pay_rate / pay_amount）。
//
// 背景（生产上表现为「课酬结算页永远 0 元」）：
//   这两个列 20260919 就加了，视图也会 coalesce 它们，但**全仓库没有任何代码写它们** ——
//   于是 25 节已完成课节全是 null，pay_amount 一路兜底到 0。
//   这里锁定「消课时写快照」这个动作：它一旦回归，课酬就又会静默变成 0。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const lessons = withErrorHandler(require("../routes/lessons.js"));

const LESSON_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };

const LESSON = {
  id: LESSON_ID,
  course_id: "22222222-2222-2222-2222-222222222222",
  teacher_id: "t-1",
  student_id: "s-1",
  scheduled_at: "2026-09-20T02:00:00.000Z",
  duration_min: 60,
  status: "scheduled",
};

// 按 URL/method 分派的 fetch stub（消课流程里裸 fetch 与 supabase-js 混用）
function stubRouter(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const method = init?.method || "GET";
    calls.push({ url: u, method, init });
    const body = handler(u, method);
    return { ok: true, status: 200, text: async () => JSON.stringify(body ?? null) };
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

function completeReq() {
  return applyMiddleware({
    method: "POST",
    url: `/${LESSON_ID}/complete`,
    headers: { authorization: "Bearer fake-jwt" },
    body: { content: "Unit 5", publishToParent: false },
    testUser: ADMIN,
  });
}

function queueForComplete() {
  resetMock();
  setMockResults([
    { data: null, error: null }, // records 幂等检查: 无
    { data: { id: "s-1", full_name: "Lily" }, error: null }, // student
    { data: { remaining_hours: 10 }, error: null }, // balance
    { data: { id: "r-1" }, error: null }, // records insert
    { data: null, error: null }, // lesson_transactions insert
    { data: null, error: null }, // audit
  ]);
}

function patchCall(f) {
  return f.calls.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/lessons?"));
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test("消课时把课酬单价与金额写成课节快照", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  queueForComplete();
  const f = stubRouter((u, m) => {
    if (m === "GET" && u.includes("/rest/v1/lessons?")) return [LESSON];
    if (m === "GET" && u.includes("/rest/v1/teachers?")) return [{ hourly_pay: 220 }];
    if (m === "PATCH" && u.includes("/rest/v1/lessons?")) return [{ id: LESSON_ID }];
    return [];
  });
  try {
    const { req, res } = completeReq();
    await lessons(req, res);
    assert.equal(res._captured.statusCode, 200);

    const patch = patchCall(f);
    assert.ok(patch, "必须发出 PATCH /rest/v1/lessons");
    const sent = JSON.parse(patch.init.body);
    assert.equal(sent.status, "completed");
    assert.equal(sent.pay_rate, 220, "课酬单价必须冻结到课节上");
    assert.equal(sent.pay_amount, 220, "60 分钟 × 220/h = 220");
  } finally {
    f.restore();
  }
});

test("按实际时长折算快照（90 分钟 × 200/h = 300）", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  queueForComplete();
  const f = stubRouter((u, m) => {
    if (m === "GET" && u.includes("/rest/v1/lessons?")) return [{ ...LESSON, duration_min: 90 }];
    if (m === "GET" && u.includes("/rest/v1/teachers?")) return [{ hourly_pay: 200 }];
    if (m === "PATCH" && u.includes("/rest/v1/lessons?")) return [{ id: LESSON_ID }];
    return [];
  });
  try {
    const { req, res } = completeReq();
    await lessons(req, res);
    const sent = JSON.parse(patchCall(f).init.body);
    assert.equal(sent.pay_rate, 200);
    assert.equal(sent.pay_amount, 300);
  } finally {
    f.restore();
  }
});

test("老师未设单价时不写快照（避免把 0 冻结进去, 交给视图按当前单价兜底）", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  queueForComplete();
  const f = stubRouter((u, m) => {
    if (m === "GET" && u.includes("/rest/v1/lessons?")) return [LESSON];
    if (m === "GET" && u.includes("/rest/v1/teachers?")) return [{ hourly_pay: 0 }];
    if (m === "PATCH" && u.includes("/rest/v1/lessons?")) return [{ id: LESSON_ID }];
    return [];
  });
  try {
    const { req, res } = completeReq();
    await lessons(req, res);
    const sent = JSON.parse(patchCall(f).init.body);
    assert.equal("pay_rate" in sent, false);
    assert.equal("pay_amount" in sent, false);
  } finally {
    f.restore();
  }
});
