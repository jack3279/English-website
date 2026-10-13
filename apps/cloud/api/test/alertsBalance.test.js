const test = require("node:test");
const assert = require("node:assert/strict");
const { mockClient, setMockResults, resetMock } = require("./mockSupabase.js");
const { getDailyLowBalanceReport } = require("../lib/alerts.js");

test.afterEach(resetMock);

test("预警使用学员总余额，包含负余额和未购包学员，详情链接有 id", async () => {
  setMockResults([
    {
      data: [
        { id: "low", full_name: "余量不足" },
        { id: "enough", full_name: "已续费" },
        { id: "negative", full_name: "欠课" },
        { id: "new", full_name: "未购包" },
      ],
      error: null,
    },
    {
      data: [
        { student_id: "low", remaining_hours: 2 },
        { student_id: "enough", remaining_hours: 12 },
        { student_id: "negative", remaining_hours: -1 },
      ],
      error: null,
    },
  ]);
  const report = await getDailyLowBalanceReport(mockClient);
  assert.deepEqual(
    report.low_balance.map((s) => s.id),
    ["low"],
  );
  assert.deepEqual(
    report.zero_balance.map((s) => s.id),
    ["negative", "new"],
  );
  assert.equal(report.zero_balance[0].remaining_hours, -1);
});

test("余额查询失败必须报错，不能显示所有学员课时充足", async () => {
  setMockResults([
    { data: [{ id: "s1", full_name: "学生" }], error: null },
    { data: null, error: new Error("balance unavailable") },
  ]);
  await assert.rejects(() => getDailyLowBalanceReport(mockClient), /balance unavailable/);
});

test("在读学员查询失败必须报错", async () => {
  setMockResults([{ data: null, error: new Error("students unavailable") }]);
  await assert.rejects(() => getDailyLowBalanceReport(mockClient), /students unavailable/);
});
