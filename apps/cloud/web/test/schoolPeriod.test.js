import { test, expect } from "vitest";
import { schoolPeriod } from "../src/lib/schoolPeriod.js";
test("月份按北京时间，UTC月末的夜间已属于中国下个月", () => {
  expect(schoolPeriod("this_month", Date.parse("2026-09-30T17:00:00Z"))).toEqual({
    from: "2026-10-01",
    to: "2026-10-01",
  });
});
test("上月跨年与近30天的区间准确", () => {
  const now = Date.parse("2027-01-01T01:00:00Z");
  expect(schoolPeriod("last_month", now)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  expect(schoolPeriod("30", now)).toEqual({ from: "2026-12-03", to: "2027-01-01" });
});

test("周一到周日跨年，上一周不会纳入本周课程", () => {
  const now = Date.parse("2027-01-03T17:00:00Z");
  expect(schoolPeriod("this_week", now)).toEqual({from:"2027-01-04",to:"2027-01-10"});
  expect(schoolPeriod("last_week", now)).toEqual({from:"2026-12-28",to:"2027-01-03"});
});
