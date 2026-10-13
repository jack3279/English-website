const test = require("node:test"),
  assert = require("node:assert/strict");
const handler = require("../routes/institutionSettings.js"),
  settings = require("../lib/institutionSettings.js");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { getDailyLowBalanceReport } = require("../lib/alerts.js");
const { mockClient } = require("./mockSupabase.js");
const { pickRenewalAlerts } = require("../src/scheduled.js");
class Bucket {
  constructor() {
    this.files = new Map();
    this.version = 0;
  }
  async get(key) {
    const row = this.files.get(key);
    return row ? { etag: row.etag, json: async () => JSON.parse(row.data) } : null;
  }
  async put(key, data, options) {
    const row = this.files.get(key);
    if (options?.onlyIf?.etagMatches && row?.etag !== options.onlyIf.etagMatches) return null;
    if (options?.onlyIf?.get?.("If-None-Match") === "*" && row) return null;
    const saved = { data, etag: String(++this.version) };
    this.files.set(key, saved);
    return saved;
  }
}
test.beforeEach(() => {
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: new Bucket(),
    PUSHPLUS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
  };
});
test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});
async function call(method, body, role = "admin") {
  const { req, res, captured } = applyMiddleware({
    url: "/",
    method,
    body,
    testUser: { id: "admin", role },
  });
  await mustHandler(handler, req, res);
  return captured;
}
test("机构默认规则与现有业务一致，单位和时区只读", async () => {
  const response = await call("GET");
  assert.equal(response.body.data.defaultDurationMin, 60);
  assert.equal(response.body.data.lowBalanceHours, 3);
  assert.equal(response.body.data.billingMinutesPerHour, 60);
  assert.equal((await call("PATCH", { billingMinutesPerHour: 30 })).statusCode, 400);
});
test("老师家长可读规则，不能改全机构设置", async () => {
  assert.equal((await call("GET", null, "parent")).statusCode, 200);
  assert.equal((await call("PATCH", { defaultDurationMin: 45 }, "teacher")).statusCode, 403);
});
test("保存规则后再次读取一致，无关配置保留且校验越界值", async () => {
  await call("PATCH", { defaultDurationMin: 45, institutionName: "英语中心" });
  const value = await settings.getSettings();
  assert.equal(value.defaultDurationMin, 45);
  assert.equal(value.leaveDeadlineHours, 4);
  assert.equal((await call("PATCH", { defaultDurationMin: 0 })).statusCode, 400);
  assert.equal((await settings.getSettings()).defaultDurationMin, 45);
});
test("低余额报告使用机构阈值而非写死3小时", async () => {
  await settings.updateSettings({ lowBalanceHours: 5 });
  setMockResults([
    { data: [{ id: "s1", full_name: "Lily" }], error: null },
    { data: [{ student_id: "s1", remaining_hours: 4 }], error: null },
  ]);
  const value = await getDailyLowBalanceReport(mockClient);
  assert.equal(value.threshold, 5);
  assert.equal(value.low_balance.length, 1);
});
test("续费阈值和到期窗口使用同一机构规则", () => {
  const now = Date.now(),
    rules = { ...settings.DEFAULTS, expiryWarnDays: 5, renewalPercent: 10, renewalMinHours: 1 };
  const alerts = pickRenewalAlerts(
    [
      {
        id: "p1",
        total_hours: 20,
        remaining_hours: 3,
        expires_at: new Date(now + 10 * 86400000).toISOString(),
      },
    ],
    now,
    rules,
  );
  assert.equal(alerts.length, 0);
});

test("缺席默认不扣课时，可保存为扣课时且不改变其他规则", async () => {
  assert.equal((await settings.getSettings()).absenceDeductHours, false);
  await settings.updateSettings({ absenceDeductHours: true });
  assert.equal((await settings.getSettings()).absenceDeductHours, true);
  assert.equal((await settings.getSettings()).defaultDurationMin, 60);
});
