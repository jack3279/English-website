const test = require("node:test"),
  assert = require("node:assert/strict");
const availability = require("../lib/teacherAvailability.js");
const cfg = {
  available: [
    { weekday: 1, start: "09:00", end: "12:00" },
    { weekday: 1, start: "13:00", end: "18:00" },
  ],
  weeklyBusy: [{ weekday: 1, start: "10:00", end: "10:30" }],
  busy: [{ id: "x", from: "2026-10-12T06:00:00.000Z", to: "2026-10-12T07:00:00.000Z" }],
};
const lesson = (time, duration = 60) => ({
  scheduled_at: "2026-10-12T" + time + ":00+08:00",
  duration_min: duration,
});
test("教师可用时段须覆盖完整课长，不能穿过午休", () => {
  assert.equal(availability.check(cfg, lesson("09:00")), null);
  assert.match(availability.check(cfg, lesson("11:30")), /可用/);
  assert.match(availability.check(cfg, lesson("08:30")), /可用/);
});
test("固定占用与具体日期占用均阻止新课，边界恰好相接允许", () => {
  assert.match(availability.check(cfg, lesson("10:00", 30)), /固定/);
  assert.match(availability.check(cfg, lesson("14:00", 30)), /个人/);
  assert.equal(availability.check(cfg, lesson("15:00")), null);
});
test("未设置可用窗口不强行限制原有排课，但仍检查个人占用", () => {
  assert.equal(
    availability.check({ ...cfg, available: [], weeklyBusy: [], busy: [] }, lesson("07:00")),
    null,
  );
  assert.match(availability.check({ ...cfg, available: [] }, lesson("14:00")), /个人/);
});
test("跨午夜课程拆成北京时间两日分别验证，不能漏检第二天", () => {
  const windows = {
    available: [{ weekday: 1, start: "00:00", end: "23:59" }],
    weeklyBusy: [{ weekday: 2, start: "00:00", end: "02:00" }],
    busy: [],
  };
  assert.match(availability.check({ ...windows, available: [] }, lesson("23:30", 60)), /固定/);
  assert.equal(availability.spans(lesson("23:30").scheduled_at, 60).length, 2);
});
test("无效日期、倒置窗口、超长占用和超过版本号被拒绝", () => {
  assert.throws(() =>
    availability.validate({
      revision: 0,
      available: [{ weekday: 1, start: "12:00", end: "09:00" }],
      weeklyBusy: [],
      busy: [],
    }),
  );
  assert.throws(() =>
    availability.validate({ revision: -1, available: [], weeklyBusy: [], busy: [] }),
  );
});
