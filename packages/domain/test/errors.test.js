const test = require("node:test");
const assert = require("node:assert/strict");
const {
  InsufficientHoursError,
  LessonNotFoundError,
  LessonNotOwnedError,
  LessonAlreadyCompletedError,
  StudentNotFoundError,
  ScheduleConflictError,
  DomainError,
} = require("../src/index.js");

test("InsufficientHoursError 携带 code 和 details", () => {
  const e = new InsufficientHoursError("s-1", 0.5);
  assert.equal(e.code, "INSUFFICIENT_HOURS");
  assert.deepEqual(e.details, { studentId: "s-1", currentBalance: 0.5 });
  assert.ok(e instanceof DomainError);
  assert.ok(e instanceof Error);
});

test("LessonNotFoundError 默认 message 包含 id", () => {
  const e = new LessonNotFoundError("l-1");
  assert.match(e.message, /l-1/);
  assert.equal(e.code, "LESSON_NOT_FOUND");
});

test("LessonNotOwnedError 携带 lesson + teacher", () => {
  const e = new LessonNotOwnedError("l-1", "t-1");
  assert.equal(e.code, "LESSON_NOT_OWNED");
  assert.deepEqual(e.details, { lessonId: "l-1", teacherId: "t-1" });
});

test("LessonAlreadyCompletedError", () => {
  const e = new LessonAlreadyCompletedError("l-1");
  assert.equal(e.code, "LESSON_ALREADY_COMPLETED");
});

test("StudentNotFoundError", () => {
  const e = new StudentNotFoundError("s-1");
  assert.equal(e.code, "STUDENT_NOT_FOUND");
  assert.deepEqual(e.details, { studentId: "s-1" });
});

test("ScheduleConflictError 聚合多冲突", () => {
  const e = new ScheduleConflictError([
    { type: "teacher", with: "e1", reason: "老师冲突" },
    { type: "student", with: "e2", reason: "学员冲突" },
  ]);
  assert.equal(e.code, "SCHEDULE_CONFLICT");
  assert.match(e.message, /老师冲突/);
  assert.match(e.message, /学员冲突/);
  assert.equal(e.details.conflicts.length, 2);
});
