const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const handler = require("../routes/finance.js");

const ROWS = [
  {
    teacher_id: "t1",
    teacher_name: "Alice",
    month: "2026-09-01",
    lessons_done: 10,
    minutes_done: 600,
    pay_amount: 2500,
  },
  {
    teacher_id: "t2",
    teacher_name: "Bob",
    month: "2026-09-01",
    lessons_done: 5,
    minutes_done: 300,
    pay_amount: 1500,
  },
];
const RATES = [
  { profile_id: "t1", hourly_pay: 250, pay_currency: "PHP", default_rate: 25000 },
  { profile_id: "t2", hourly_pay: 300, pay_currency: "PHP" },
];

test("GET /finance/payroll 汇总课酬与合计", async () => {
  resetMock();
  setMockResults([
    { data: ROWS, error: null },
    { data: RATES, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/payroll?from=2026-09-01&to=2026-09-30",
    testUser: { id: "admin1", role: "admin" },
  });
  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  const { rows, totals, rates } = captured.body.data;
  assert.equal(rows.length, 2);
  assert.equal(totals.teachers, 2);
  assert.equal(totals.lessons_done, 15);
  assert.equal(totals.hours, 15);
  assert.equal(totals.pay_amount, 4000);
  assert.deepEqual(totals.by_currency, { PHP: 4000 });
  assert.equal(rates[0].hourly_pay, 250);
});

test("课酬不同币种分开汇总，缺少教师币种不会冒充PHP", async () => {
  for (const rates of [[RATES[0], { ...RATES[1], pay_currency: "USD" }], [RATES[0]]]) {
    resetMock();
    setMockResults([
      { data: ROWS.map((r) => ({ ...r })), error: null },
      { data: rates, error: null },
    ]);
    const { req, res, captured } = applyMiddleware({
      method: "GET",
      url: "/payroll",
      testUser: { id: "admin1", role: "admin" },
    });
    await handler(req, res);
    const result = captured.body.data;
    assert.equal(result.totals.pay_amount, null);
    assert.equal(result.totals.by_currency.PHP, 2500);
    assert.equal(result.totals.by_currency[rates.length === 2 ? "USD" : "UNSPECIFIED"], 1500);
  }
});

test("GET /finance/payroll 非 admin 被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/payroll",
    testUser: { id: "t1", role: "teacher" },
  });
  await assert.rejects(() => handler(req, res));
  assert.equal(captured.statusCode, 403);
});

test("POST /finance/payroll/rate 走 raw PATCH 更新 teachers.hourly_pay", async () => {
  resetMock();
  const originalFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    posted = { url: String(url), opts };
    return { ok: true, status: 200, text: async () => "[{}]" };
  };
  try {
    const { req, res, captured } = applyMiddleware({
      method: "POST",
      url: "/payroll/rate",
      body: { teacher_id: "11111111-1111-1111-1111-111111111111", hourly_pay: 300 },
      testUser: { id: "admin1", role: "admin" },
    });
    await handler(req, res);
    assert.equal(captured.statusCode, 200);
    assert.ok(posted.url.includes("/rest/v1/teachers"));
    assert.ok(posted.url.includes("profile_id=eq."));
    assert.deepEqual(JSON.parse(posted.opts.body), { hourly_pay: 300 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /finance/payroll/rate 参数非法返回 400", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/payroll/rate",
    body: { teacher_id: "not-a-uuid", hourly_pay: 100 },
    testUser: { id: "admin1", role: "admin" },
  });
  await handler(req, res);
  assert.equal(captured.statusCode, 400);
});
