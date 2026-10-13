import { test, expect } from "vitest";
import { lessonTimeRange, validLessonDate } from "../src/lib/lessonDisplay.js";

test("课节时间非法时显示待定，不产生 Invalid Date", () => {
  expect(validLessonDate("not-a-date")).toBeNull();
  expect(lessonTimeRange({ scheduled_at: "not-a-date", duration_min: 60 })).toBe("时间待定");
});

test("课节时间按北京时间生成起止时间", () => {
  expect(
    lessonTimeRange({ scheduled_at: "2026-10-13T02:00:00Z", duration_min: 90 }),
  ).toBe("10:00–11:30");
});
