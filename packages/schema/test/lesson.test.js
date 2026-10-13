const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CompleteLessonInput,
  CreateScheduleInput,
  UpdateScheduleInput,
  Lesson,
  Student,
  ParentFeed,
} = require("../src/index.js");

test("CompleteLessonInput 默认 publishToParent=true", () => {
  const r = CompleteLessonInput.parse({ content: "x" });
  assert.equal(r.publishToParent, true);
});

test("CompleteLessonInput 拒绝空 content", () => {
  assert.throws(() => CompleteLessonInput.parse({ content: "" }));
});

test("CompleteLessonInput 拒绝超长 content (>5000)", () => {
  assert.throws(() => CompleteLessonInput.parse({ content: "a".repeat(5001) }));
});

test("CreateScheduleInput 默认 duration=60", () => {
  const r = CreateScheduleInput.parse({
    teacher_id: "00000000-0000-0000-0000-000000000001",
    student_id: "00000000-0000-0000-0000-000000000002",
    scheduled_at: "2026-09-07T16:00:00Z",
  });
  assert.equal(r.duration_min, 60);
});

test("CreateScheduleInput 拒绝非法 datetime", () => {
  assert.throws(() =>
    CreateScheduleInput.parse({
      teacher_id: "00000000-0000-0000-0000-000000000001",
      student_id: "00000000-0000-0000-0000-000000000002",
      scheduled_at: "not-a-date",
    }),
  );
});

test("UpdateScheduleInput 接受空对象", () => {
  const r = UpdateScheduleInput.parse({});
  assert.deepEqual(r, {});
});

test("Lesson 接受完整对象", () => {
  const r = Lesson.parse({
    id: "00000000-0000-0000-0000-000000000001",
    course_id: null,
    teacher_id: "00000000-0000-0000-0000-000000000002",
    student_id: "00000000-0000-0000-0000-000000000003",
    scheduled_at: "2026-09-07T16:00:00Z",
    duration_min: 60,
    status: "scheduled",
    completed_at: null,
    leave_status: null,
    leave_reason: null,
  });
  assert.equal(r.status, "scheduled");
});

test("Lesson 拒绝非法 status", () => {
  assert.throws(() =>
    Lesson.parse({
      id: "00000000-0000-0000-0000-000000000001",
      course_id: null,
      teacher_id: "00000000-0000-0000-0000-000000000002",
      student_id: "00000000-0000-0000-0000-000000000003",
      scheduled_at: "2026-09-07T16:00:00Z",
      duration_min: 60,
      status: "invalid_status",
      completed_at: null,
      leave_status: null,
      leave_reason: null,
    }),
  );
});

test("Student 接受 minimal", () => {
  const r = Student.parse({
    id: "00000000-0000-0000-0000-000000000001",
    full_name: "X",
    birth_date: null,
    branch_id: null,
    status: "active",
  });
  assert.equal(r.full_name, "X");
});

test("ParentFeed 完整", () => {
  const r = ParentFeed.parse({
    id: "00000000-0000-0000-0000-000000000001",
    record_id: "00000000-0000-0000-0000-000000000002",
    student_id: "00000000-0000-0000-0000-000000000003",
    summary: "good",
    published_at: "2026-09-07T16:00:00Z",
  });
  assert.equal(r.summary, "good");
});
