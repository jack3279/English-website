import { test, expect } from "vitest";
import {
  analyzeSchedule,
  assignLanes,
  matchesScheduleFilter,
  lessonAppearance,
  inputToIso,
  schoolInput,
  DEFAULT_LOAD_LIMITS,
} from "../src/features/schedule/scheduleInsights.js";
const lesson = (id, time, duration = 60, extra = {}) => ({
  id,
  teacher_id: "t1",
  student_id: `s-${id}`,
  scheduled_at: `2026-10-09T${time}:00+08:00`,
  duration_min: duration,
  status: "scheduled",
  profiles: { full_name: "Teacher" },
  ...extra,
});
test("同一天多节课不是冲突，背靠背不视为重叠", () => {
  const result = analyzeSchedule([
    lesson("a", "09:00"),
    lesson("b", "10:00"),
    lesson("c", "16:00"),
  ]);
  expect(result.conflicts).toHaveLength(0);
  expect(result.warnings).toHaveLength(0);
});
test("按实际起止时间发现部分重叠，而非仅比较开始时间", () => {
  const result = analyzeSchedule([lesson("a", "09:00", 120), lesson("b", "10:30")]);
  expect(result.conflicts.map((pair) => pair.kind)).toEqual(["teacher"]);
  expect(result.byLesson.get("a")).toContain("教师时间冲突");
});
test("不同老师给同一学员同时上课仍会显示学员冲突", () => {
  const result = analyzeSchedule([
    lesson("a", "09:00", 60, { student_id: "s1" }),
    lesson("b", "09:30", 60, { teacher_id: "t2", student_id: "s1" }),
  ]);
  expect(result.conflicts.map((pair) => pair.kind)).toEqual(["student"]);
});
test("取消、缺席与已批准请假不会占用教师负荷或阻塞新排课", () => {
  const result = analyzeSchedule([
    lesson("a", "09:00"),
    lesson("b", "09:00", 240, { status: "cancelled" }),
    lesson("c", "09:00", 240, { status: "no_show" }),
    lesson("d", "09:00", 240, { leave_status: "approved" }),
  ]);
  expect(result.conflicts).toHaveLength(0);
  expect(result.warnings).toHaveLength(0);
});
test("短休息连续三节课会提醒，休息达到阈值会打断连堂", () => {
  expect(
    analyzeSchedule([lesson("a", "09:00"), lesson("b", "10:10"), lesson("c", "11:20")]).warnings[0],
  ).toMatchObject({ type: "consecutive", count: 3 });
  expect(
    analyzeSchedule([lesson("a", "09:00"), lesson("b", "10:15"), lesson("c", "11:30")]).warnings,
  ).toHaveLength(0);
});
test("日和周超限分别统计，重复课节不会重复计入", () => {
  const a = lesson("a", "08:00", 240),
    b = lesson("b", "12:00", 240);
  const result = analyzeSchedule([a, b, a], { ...DEFAULT_LOAD_LIMITS, weeklyHours: 7 });
  expect(result.warnings.map((w) => w.type)).toEqual(["day", "week"]);
  expect(result.warnings[0].hours).toBe(8);
});
test("跨午夜、跨周课节按北京时间拆分，而非全算到开始那天", () => {
  const row = lesson("a", "23:30", 120, { scheduled_at: "2026-10-11T23:30:00+08:00" });
  const result = analyzeSchedule([row], { ...DEFAULT_LOAD_LIMITS, dailyHours: 1, weeklyHours: 1 });
  expect(result.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "day", period: "2026-10-12", hours: 1.5 }),
      expect.objectContaining({ type: "week", period: "2026-10-12", hours: 1.5 }),
    ]),
  );
});
test("异常状态和调课记录都可单独过滤，未批准请假仍保留上课安排", () => {
  expect(
    matchesScheduleFilter(lesson("a", "09:00", 60, { leave_status: "pending" }), "leave"),
  ).toBe(true);
  expect(
    matchesScheduleFilter(lesson("a", "09:00", 60, { rescheduled_at: "2026-10-08" }), "exceptions"),
  ).toBe(true);
  expect(
    matchesScheduleFilter(lesson("a", "09:00", 60, { status: "cancelled" }), "cancelled"),
  ).toBe(true);
  expect(lessonAppearance(lesson("a", "09:00", 60, { status: "no_show" })).label).toBe("缺席");
  const cancelledLeave = lessonAppearance(
    lesson("a", "09:00", 60, { status: "cancelled", leave_status: "approved" }),
  );
  expect(cancelledLeave.label).toBe("已取消 · 请假");
  expect(cancelledLeave.className).toContain("bg-gray-100");
});
test("时间输入明确按北京时间转换，非法日期不能保存", () => {
  expect(schoolInput("2026-10-09T08:00:00Z")).toBe("2026-10-09T16:00");
  expect(inputToIso("2026-10-09T16:00")).toBe("2026-10-09T08:00:00.000Z");
  expect(inputToIso("2026-02-31T16:00")).toBe(null);
});
test("时间轴为部分重叠分配不同栏位，邻接课节可复用栏位", () => {
  const rows = assignLanes([
    { lesson: lesson("a", "09:00", 90), colIdx: 0 },
    { lesson: lesson("b", "10:00", 60), colIdx: 0 },
    { lesson: lesson("c", "11:00"), colIdx: 0 },
  ]);
  expect(rows[0].slot).not.toBe(rows[1].slot);
  expect(rows[0].laneCount).toBe(2);
  expect(rows[2].laneCount).toBe(1);
});
