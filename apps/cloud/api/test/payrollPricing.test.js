const test = require("node:test"),
  assert = require("node:assert/strict");
const { setMockResults, resetMock } = require("./setup.js");
const pricing = require("../lib/payrollPricing.js"),
  store = require("../lib/secureStore.js");
const reporting = require("../lib/payrollReport.js");
const settlement = require("../lib/payrollPeriodSettlement.js");
const confirmation = require("../lib/adminConfirmation.js");
const teacher = "22222222-2222-4222-8222-222222222222",
  student = "33333333-3333-4333-8333-333333333333",
  course = "44444444-4444-4444-8444-444444444444";
class Bucket {
  constructor() {
    this.files = new Map();
    this.i = 0;
  }
  async get(k) {
    const r = this.files.get(k);
    return r ? { etag: r.etag, json: async () => JSON.parse(r.data) } : null;
  }
  async put(k, data, o) {
    const old = this.files.get(k);
    if (
      (o?.onlyIf?.etagMatches && old?.etag !== o.onlyIf.etagMatches) ||
      (o?.onlyIf?.get?.("If-None-Match") === "*" && old)
    )
      return null;
    const r = { etag: String(++this.i), data };
    this.files.set(k, r);
    return r;
  }
}
const verify = confirmation.verify;
test.beforeEach(() => {
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: new Bucket(),
    ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  };
  confirmation.verify = async () => {};
});
test.afterEach(() => {
  delete globalThis.__CLOUDFLARE_ENV;
  confirmation.verify = verify;
  resetMock();
});
const lesson = {
  id: "11111111-1111-4111-8111-111111111111",
  teacher_id: teacher,
  student_id: student,
  course_id: course,
  scheduled_at: "2026-10-04T16:00:00Z",
  duration_min: 90,
  status: "completed",
  pay_rate: 12,
  pay_amount: 18,
};
test("学生课程优先于课程价和默认价，未来规则不提前生效，零价不丢失", () => {
  const cfg = {
    defaults: [{ effective_from: "2026-10-01", at: "2026-10-01", hourly_pay: 10, currency: "PHP" }],
    rules: [
      {
        id: "course",
        active: true,
        course_id: course,
        student_id: null,
        effective_from: "2026-10-01",
        hourly_pay: 12,
        currency: "USD",
        student_price: 150,
      },
      {
        id: "special",
        active: true,
        course_id: course,
        student_id: student,
        effective_from: "2026-10-01",
        hourly_pay: 0,
        currency: "EUR",
        student_price: 0,
      },
      {
        id: "future",
        active: true,
        course_id: course,
        student_id: student,
        effective_from: "2026-11-01",
        hourly_pay: 99,
        currency: "USD",
      },
    ],
  };
  assert.deepEqual(pricing.resolve(lesson, { hourly_pay: 88 }, cfg), {
    hourly_pay: 0,
    currency: "EUR",
    student_price: 0,
    rule_id: "special",
  });
  assert.equal(pricing.resolve({ ...lesson, student_id: "other" }, {}, cfg).hourly_pay, 12);
  assert.equal(
    pricing.resolve({ ...lesson, course_id: "other", student_id: "other" }, {}, cfg).hourly_pay,
    10,
  );
});
test("自然周跨月跨年，北京时间午夜归属正确", () => {
  assert.deepEqual(reporting.periodFor("2027-01-01", "weekly"), {
    from: "2026-12-28",
    to: "2027-01-03",
  });
  assert.deepEqual(reporting.periodFor("2028-02-29", "monthly"), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
  assert.equal(pricing.dayOf(lesson.scheduled_at), "2026-10-05");
});
test("完课快照保留币种、学生收费与显式零价，后续改价不会重算", async () => {
  await store.change("private/payroll-pricing/v1", { teachers: {} }, () => ({
    teachers: {
      [teacher]: {
        defaults: [
          { effective_from: "2026-10-01", at: "2026-10-01", hourly_pay: 0, currency: "USD" },
        ],
        rules: [],
      },
    },
  }));
  const first = await pricing.snapshot(lesson, { hourly_pay: 10, pay_currency: "PHP" });
  assert.equal(first.amount, 0);
  assert.equal(first.currency, "USD");
  const again = await pricing.snapshot(lesson, { hourly_pay: 90, pay_currency: "EUR" });
  assert.deepEqual(again, first);
});
function dataForReport() {
  setMockResults([
    { data: [lesson] },
    { data: [{ profile_id: teacher, hourly_pay: 99, pay_currency: "PHP" }] },
    { data: [{ id: teacher, full_name: "教师甲" }] },
    { data: [{ id: course, name: "英语" }] },
    { data: [{ id: student, full_name: "学生甲" }] },
  ]);
}
test("周统计使用课节金额和冻结币种，学生金额与工资独立", async () => {
  await store.change(pricing.snapshotKey(lesson.id), null, () => ({
    ...lesson,
    currency: "USD",
    hourly_pay: 12,
    amount: 18,
    student_price: 150,
    student_amount: 225,
  }));
  dataForReport();
  const r = await reporting.report(
    { context: { role: "admin" } },
    new URLSearchParams({ period: "weekly", from: "2026-10-05", to: "2026-10-11" }),
  );
  assert.equal(r.rows[0].pay_amount, 18);
  assert.equal(r.rows[0].pay_currency, "USD");
  assert.equal(r.rows[0].period_from, "2026-10-05");
  assert.equal(r.details[0].student_amount, 225);
  assert.deepEqual(r.totals.by_currency, { USD: 18 });
});
test("旧月度发放阻止同月周结重复登记", async () => {
  await store.change("private/payroll-settlements/state-v1", {}, () => ({
    old: {
      teacher_id: teacher,
      month: "2026-10",
      currency: "PHP",
      state: "paid",
      amount_cents: 1800,
    },
  }));
  dataForReport();
  await assert.rejects(
    () =>
      settlement.save(
        { context: { role: "admin", userId: "admin" } },
        {
          teacher_id: teacher,
          period: "weekly",
          from: "2026-10-05",
          to: "2026-10-11",
          expected_currency: "PHP",
          expected_amount_cents: 1800,
          confirmed: true,
          current_password: "private",
        },
      ),
    (e) => e.code === "PAYROLL_OVERLAP",
  );
});
test("价格修改拒绝倒填历史日期、重复同级规则以及过期版本", async () => {
  const body = {
    teacher_id: teacher,
    hourly_pay: 12,
    currency: "USD",
    cycle: "weekly",
    rules: [],
    revision: 1,
  };
  setMockResults([{ data: { profile_id: teacher, hourly_pay: 10, pay_currency: "PHP" } }]);
  await assert.rejects(
    () => pricing.save({ context: { role: "admin" } }, body),
    (e) => e.code === "PRICING_CHANGED",
  );
  setMockResults([{ data: { profile_id: teacher, hourly_pay: 10, pay_currency: "PHP" } }]);
  await assert.rejects(
    () =>
      pricing.save(
        { context: { role: "admin" } },
        {
          ...body,
          revision: 0,
          rules: [
            {
              course_id: null,
              student_id: null,
              hourly_pay: 12,
              currency: "USD",
              student_price: null,
              active: true,
              effective_from: "2020-01-01",
            },
          ],
        },
      ),
    (e) => e.code === "PRICING_PAST",
  );
});

test("老师报表隐藏学生约定收费，未知日期不会变成服务器错误", async () => {
  await store.change(pricing.snapshotKey(lesson.id), null, () => ({
    currency: "USD",
    student_price: 150,
    student_amount: 225,
  }));
  dataForReport();
  const result = await reporting.report(
    { context: { role: "teacher", userId: teacher } },
    new URLSearchParams({ period: "weekly" }),
  );
  assert.equal(result.details[0].student_price, null);
  assert.equal(result.details[0].student_amount, null);
  await assert.rejects(
    () =>
      reporting.report({ context: { role: "admin" } }, new URLSearchParams({ from: "2026-02-30" })),
    (e) => e.code === "PAYROLL_WINDOW",
  );
});

test("新周期登记幂等、金额变化拒绝登记，撤销保留历史", async () => {
  const req = { context: { role: "admin", userId: "admin" } };
  const input = {
    teacher_id: teacher,
    period: "weekly",
    from: "2026-10-05",
    to: "2026-10-11",
    expected_currency: "PHP",
    expected_amount_cents: 1800,
    confirmed: true,
    current_password: "private",
  };
  dataForReport();
  const first = await settlement.save(req, input);
  dataForReport();
  const replay = await settlement.save(req, input);
  assert.equal(replay.at, first.at);
  dataForReport();
  await assert.rejects(
    () => settlement.save(req, { ...input, expected_amount_cents: 1000 }),
    (e) => e.code === "PAYROLL_CHANGED",
  );
  const retracted = await settlement.save(req, { ...input, mode: "retract", note: "登记有误" });
  assert.equal(retracted.state, "retracted");
  assert.equal(retracted.history[0].state, "paid");
});
