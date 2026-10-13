const test = require("node:test"),
  assert = require("node:assert/strict");
const { setMockResults, resetMock } = require("./setup.js");
const confirmation = require("../lib/adminConfirmation.js");
const conversion = require("../lib/leadConversion.js");
const settlements = require("../lib/payrollSettlements.js");
const preferences = require("../lib/notificationPreferences.js");
class Bucket {
  constructor() {
    this.files = new Map();
    this.version = 0;
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
    const row = { data, etag: String(++this.version) };
    this.files.set(k, row);
    return row;
  }
}
const ids = {
  lead: "11111111-1111-4111-8111-111111111111",
  teacher: "22222222-2222-4222-8222-222222222222",
  branch: "33333333-3333-4333-8333-333333333333",
  parent: "44444444-4444-4444-8444-444444444444",
};
const req = { context: { userId: "admin", role: "admin", jwt: "test" }, reqId: "qa" };
const verify = confirmation.verify,
  originalFetch = globalThis.fetch;
let writes, failLink;
test.beforeEach(() => {
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: new Bucket(),
    ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    SUPABASE_URL: "https://qa.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "qa-key",
  };
  confirmation.verify = async () => {};
  writes = [];
  failLink = false;
  globalThis.fetch = async (url, options) => {
    writes.push({
      url: String(url),
      method: options.method,
      body: JSON.parse(options.body || "[]"),
    });
    const bad = failLink && String(url).includes("/parent_student_links");
    return {
      ok: !bad,
      status: bad ? 503 : 200,
      text: async () => (bad ? "unavailable" : '[{"id":"saved"}]'),
    };
  };
});
test.afterEach(() => {
  confirmation.verify = verify;
  globalThis.fetch = originalFetch;
  delete globalThis.__CLOUDFLARE_ENV;
  resetMock();
});
const convertInput = () => ({
  full_name: "学员甲",
  birth_date: null,
  branch_id: ids.branch,
  confirmed: true,
  current_password: "private-password",
});
test("成交建档幂等：重复确认不新增第二个学员，不写缴费或课时流水", async () => {
  setMockResults([
    { data: { id: ids.lead, status: "contacted" } },
    { data: { id: ids.branch } },
    { data: null },
  ]);
  const first = await conversion.convert(req, ids.lead, convertInput());
  setMockResults([{ data: { id: ids.lead, status: "converted" } }, { data: { id: ids.branch } }]);
  const again = await conversion.convert(req, ids.lead, convertInput());
  assert.equal(first.student_id, again.student_id);
  assert.equal(writes.filter((r) => r.url.endsWith("/students")).length, 1);
  assert.equal(
    writes.some((r) => /package_payments|lesson_transactions/.test(r.url)),
    false,
  );
  const state = (await conversion.mapping())[ids.lead];
  assert.equal(state.state, "done");
  assert(!JSON.stringify(state).includes("private-password"));
});
test("家长关联失败保留建档进度，相同资料重试沿用原学员", async () => {
  const body = { ...convertInput(), parent_id: ids.parent };
  setMockResults([
    { data: { id: ids.lead } },
    { data: { id: ids.branch } },
    { data: { id: ids.parent, profiles: { role: "parent" } } },
    { data: null },
    { data: [] },
  ]);
  failLink = true;
  await assert.rejects(conversion.convert(req, ids.lead, body), { code: "CONVERSION_PENDING" });
  const draft = (await conversion.mapping())[ids.lead];
  assert.equal(draft.studentCreated, true);
  assert.equal(draft.state, "pending");
  failLink = false;
  setMockResults([
    { data: { id: ids.lead } },
    { data: { id: ids.branch } },
    { data: { id: ids.parent, profiles: { role: "parent" } } },
    { data: { id: draft.student_id } },
    { data: [] },
  ]);
  const final = await conversion.convert(req, ids.lead, body);
  assert.equal(final.student_id, draft.student_id);
  assert.equal(writes.filter((r) => r.url.endsWith("/students")).length, 1);
});
test("发放登记金额由服务端计算，重复登记不重复通知；撤销保留历史", async () => {
  const body = {
    teacher_id: ids.teacher,
    month: "2026-10",
    confirmed: true,
    current_password: "private-password",
    expected_amount_cents: 10000,
    expected_currency: "PHP",
  };
  setMockResults([{ data: [{ pay_amount: 100 }] }, { data: { pay_currency: "PHP" } }]);
  const paid = await settlements.save(req, body);
  assert.equal(paid.amount_cents, 10000);
  const writesAfterFirst = writes.length;
  setMockResults([{ data: [{ pay_amount: 100 }] }, { data: { pay_currency: "PHP" } }]);
  await settlements.save(req, body);
  assert.equal(writes.length, writesAfterFirst);
  const reverted = await settlements.save(req, { ...body, mode: "retract", note: "登记有误" });
  assert.equal(reverted.state, "retracted");
  assert.equal(reverted.history[0].state, "paid");
  const otherTeacher = await settlements.list({ context: { role: "teacher", userId: "other" } });
  assert.deepEqual(otherTeacher.records, []);
  await assert.rejects(settlements.save(req, { ...body, amount_cents: 1 }), {
    code: "PAYROLL_CONFIRMATION_REQUIRED",
  });
});
test("已登记后应计金额变化不得静默覆盖", async () => {
  const body = {
    teacher_id: ids.teacher,
    month: "2026-10",
    confirmed: true,
    current_password: "private-password",
    expected_amount_cents: 10000,
    expected_currency: "PHP",
  };
  setMockResults([{ data: [{ pay_amount: 100 }] }, { data: { pay_currency: "PHP" } }]);
  await settlements.save(req, body);
  setMockResults([{ data: [{ pay_amount: 200 }] }, { data: { pay_currency: "PHP" } }]);
  await assert.rejects(settlements.save(req, body), { code: "PAYROLL_CHANGED" });
});
test("通知偏好按账号隔离，只静音指定类别，不删除通知", async () => {
  await preferences.save("parent-a", { categories: { feedback: false } });
  const a = await preferences.read("parent-a"),
    b = await preferences.read("parent-b");
  assert.equal(preferences.muted({ type: "report" }, a), true);
  assert.equal(preferences.muted({ type: "class_report" }, b), false);
  assert.equal(preferences.muted({ type: "leave" }, a), false);
  assert.equal(writes.length, 0);
  await assert.rejects(preferences.save("parent-a", { categories: { unknown: false } }), {
    code: "PREFERENCES_INVALID",
  });
});
test("管理员确认使用隔离客户端，并校验当前账号身份", async () => {
  confirmation.verify = verify;
  setMockResults([{ data: { user: { id: "other", email: "qa@example.invalid" } } }]);
  await assert.rejects(confirmation.verify(req, "not-public-password"), { code: "UNAUTHORIZED" });
  setMockResults([
    { data: { user: { id: "admin", email: "qa@example.invalid" } } },
    { data: { user: { id: "admin" } } },
    { error: null },
  ]);
  await confirmation.verify(req, "not-public-password");
});
