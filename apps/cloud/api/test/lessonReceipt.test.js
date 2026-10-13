const test = require("node:test"),
  assert = require("node:assert/strict");
const { setMockResults, resetMock } = require("./setup.js");
const receipt = require("../lib/lessonReceipt.js");
const lesson = {
  id: "11111111-1111-4111-8111-111111111111",
  teacher_id: "teacher",
  student_id: "student",
  status: "completed",
};
const req = { context: { role: "teacher", userId: "teacher" }, reqId: "qa" };
let writes;
const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  writes = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    writes.push({ url: String(url), body, method: options.method });
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  resetMock();
});
test("补发缺失的上课确认只写反馈和发布，不扣课时、不改工资", async () => {
  setMockResults([{ data: lesson }, { data: null }, { data: null }, { data: [] }, { data: null }]);
  const result = await receipt.publish(req, lesson.id);
  assert.equal(result.published, true);
  assert.equal(writes.length, 2);
  assert.ok(writes[0].url.includes("/records"));
  assert.ok(writes[1].url.includes("/parent_feeds"));
  assert.equal(writes[0].body[0].content, receipt.BASIC);
  assert.equal(writes[0].body[0].performance, "");
  assert.equal(
    writes.some((w) => /lesson_transactions|student_packages|teachers|\/lessons/.test(w.url)),
    false,
  );
});
test("已发布确认幂等不重复通知，也不覆盖已有老师反馈", async () => {
  setMockResults([
    { data: lesson },
    { data: { id: "record", content: "学习Unit 5", performance: "积极参与" } },
    { data: { id: "feed" } },
  ]);
  assert.equal((await receipt.publish(req, lesson.id)).idempotent, true);
  assert.equal(writes.length, 0);
});
test("不能为未完课、别人的课程或家长身份补发", async () => {
  setMockResults([{ data: { ...lesson, status: "scheduled" } }]);
  await assert.rejects(
    () => receipt.publish(req, lesson.id),
    (e) => e.code === "LESSON_NOT_COMPLETED",
  );
  setMockResults([{ data: { ...lesson, teacher_id: "other" } }]);
  await assert.rejects(
    () => receipt.publish(req, lesson.id),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () => receipt.publish({ context: { role: "parent" } }, lesson.id),
    (e) => e.status === 403,
  );
  assert.equal(writes.length, 0);
});
