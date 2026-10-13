// 守卫: 老师看自己的课酬。
//
// 这是一个「按身份取数」的接口，最危险的不是算错钱，而是**越权**：
// 一旦收件人取自请求参数而非登录身份，改一个 uuid 就能看同事的工资。
// 所以这里除了算账，重点锁住：老师能看、家长不能看、且**不接受任何传参指定他人**。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const finance = withErrorHandler(require("../routes/finance.js"));

const TEACHER = { id: "11111111-1111-1111-1111-111111111111", role: "teacher", full_name: "E" };
const ADMIN = { id: "22222222-2222-2222-2222-222222222222", role: "admin", full_name: "A" };
const PARENT = { id: "33333333-3333-3333-3333-333333333333", role: "parent", full_name: "P" };

function withEnv(fn) {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  return fn();
}

function call(user, qs = "") {
  return applyMiddleware({
    method: "GET",
    url: `/my-payroll${qs}`,
    headers: { authorization: "Bearer fake" },
    testUser: user,
  });
}

// 三次真实查询的顺序: ① teachers ② teacher_payroll ③ lessons
function queueHappyPath() {
  setMockResults([
    {
      data: { profile_id: TEACHER.id, hourly_pay: 200, pay_currency: "PHP", active: true },
      error: null,
    },
    {
      data: [
        { month: "2026-09-01", lessons_done: 3, minutes_done: 180, pay_amount: 600 },
        { month: "2026-08-01", lessons_done: 10, minutes_done: 600, pay_amount: 2000 },
      ],
      error: null,
    },
    {
      data: [
        {
          id: "l-1",
          scheduled_at: "2026-09-20T08:00:00.000Z",
          duration_min: 60,
          pay_amount: null, // 没快照 -> 回退到 pay_rate
          pay_rate: 200,
          students: { full_name: "小明" },
        },
      ],
      error: null,
    },
  ]);
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test("老师可以看自己的课酬: 汇总按月累加", () =>
  withEnv(async () => {
    queueHappyPath();
    const { req, res, captured } = call(TEACHER);
    await finance(req, res);
    assert.equal(captured.statusCode, 200, JSON.stringify(captured.body));
    const d = captured.body.data;
    assert.equal(d.teacher.hourly_pay, 200);
    assert.equal(d.teacher.pay_currency, "PHP");
    assert.equal(d.months.length, 2);
    assert.equal(d.totals.lessons_done, 13);
    assert.equal(d.totals.hours, 13); // (180+600)/60
    assert.equal(d.totals.pay_amount, 2600);
  }));

test("明细: 没有快照时按 pay_rate 折算, 并标注计价依据", () =>
  withEnv(async () => {
    queueHappyPath();
    const { req, res, captured } = call(TEACHER);
    await finance(req, res);
    const row = captured.body.data.recent[0];
    assert.equal(row.amount, 200, "60 分钟 × 200/h");
    assert.equal(row.from_snapshot, false);
    assert.equal(row.student_name, "小明");
  }));

test("明细: 有快照就用快照(改单价不影响已结算的课)", () =>
  withEnv(async () => {
    setMockResults([
      {
        data: { profile_id: TEACHER.id, hourly_pay: 300, pay_currency: "PHP", active: true },
        error: null,
      },
      { data: [], error: null },
      {
        data: [
          {
            id: "l-2",
            scheduled_at: "2026-09-19T08:00:00.000Z",
            duration_min: 90,
            pay_amount: 300, // 快照: 当时单价 200 × 1.5h
            pay_rate: 200,
            students: { full_name: "小红" },
          },
        ],
        error: null,
      },
    ]);
    const { req, res, captured } = call(TEACHER);
    await finance(req, res);
    const row = captured.body.data.recent[0];
    assert.equal(row.amount, 300, "要用快照 300, 而不是当前单价 300 × 1.5 = 450");
    assert.equal(row.from_snapshot, true);
  }));

test("家长不能看课酬(403)", () =>
  withEnv(async () => {
    const { req, res, captured } = call(PARENT);
    await finance(req, res);
    assert.equal(captured.statusCode, 403);
  }));

test("接口不接受用参数指定他人 —— 传了也不影响(只看自己)", () =>
  withEnv(async () => {
    // 静态守卫: my-payroll 的实现里不得从 query/body 取 teacher_id/profile_id。
    // 行为上 mock 拦不住越权(它不记录查询条件), 所以用源码断言兜住。
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", "finance.js"), "utf8");
    const start = src.indexOf("async function myPayroll");
    assert.ok(start > -1, "找不到 myPayroll");
    const end = src.indexOf("module.exports = async function handler", start);
    const body = src.slice(start, end);
    assert.ok(
      !/searchParams\.get\(\s*["'`](teacher_id|teacherId|profile_id)/.test(body),
      "不得从 query 取他人 id",
    );
    assert.ok(!/body\.teacher_id|body\??\.profile_id/.test(body), "不得从 body 取他人 id");
    assert.match(body, /req\.context\.userId/, "必须用登录身份");
  }));

test("管理员打开看到所有老师汇总，无数据时为空聚合而不是报错", () =>
  withEnv(async () => {
    // 管理员走「所有老师汇总」分支: ① teacher_payroll ② teachers (profiles 空名单不发请求)
    setMockResults([
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const { req, res, captured } = call(ADMIN);
    await finance(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.scope, "all");
    assert.equal(captured.body.data.role, "admin");
    assert.equal(captured.body.data.teachers.length, 0);
    assert.equal(captured.body.data.totals.pay_amount, 0);
  }));
