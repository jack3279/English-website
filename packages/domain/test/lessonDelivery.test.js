const test = require("node:test");
const assert = require("node:assert/strict");
const { compute } = require("../src/index.js");
const {
  InsufficientHoursError,
  LessonAlreadyCompletedError,
  LessonNotOwnedError,
  StudentNotFoundError,
} = require("../src/index.js");

const baseLesson = {
  id: "l-1",
  teacher_id: "t-1",
  student_id: "s-1",
  status: "scheduled",
  duration_min: 60,
};
const baseStudent = { id: "s-1", full_name: "Lily" };
const baseTeacher = { id: "t-1" };
const baseRecord = {
  content: "Unit 5",
  performance: "好",
  homework: "WB P23",
  next_plan: "Unit 6",
};

test("compute 返回完整副作用对象", () => {
  const out = compute({
    lesson: baseLesson,
    student: baseStudent,
    teacher: baseTeacher,
    currentBalance: 10,
    record: baseRecord,
    publishToParent: true,
  });
  assert.ok(out.record);
  assert.equal(out.record.lesson_id, "l-1");
  assert.equal(out.lessonTransaction.delta, -1);
  assert.equal(out.lessonTransaction.reason, "consume");
  assert.equal(out.lessonUpdate.status, "completed");
  assert.ok(out.lessonUpdate.completed_at);
  assert.ok(out.parentFeed);
  assert.equal(out.parentFeed.student_id, "s-1");
  assert.equal(out.newBalance, 9);
});

test("compute 不发布家长反馈时 parentFeed 为 null", () => {
  const out = compute({
    lesson: baseLesson,
    student: baseStudent,
    teacher: baseTeacher,
    currentBalance: 10,
    record: baseRecord,
    publishToParent: false,
  });
  assert.equal(out.parentFeed, null);
});

test("compute 余额不足抛 InsufficientHoursError", () => {
  assert.throws(
    () =>
      compute({
        lesson: baseLesson,
        student: baseStudent,
        teacher: baseTeacher,
        currentBalance: 0.5,
        record: baseRecord,
        publishToParent: true,
      }),
    InsufficientHoursError,
  );
});

test("compute 课次已完成抛 LessonAlreadyCompletedError", () => {
  assert.throws(
    () =>
      compute({
        lesson: { ...baseLesson, status: "completed" },
        student: baseStudent,
        teacher: baseTeacher,
        currentBalance: 10,
        record: baseRecord,
        publishToParent: true,
      }),
    LessonAlreadyCompletedError,
  );
});

test("compute 老师不匹配抛 LessonNotOwnedError", () => {
  assert.throws(
    () =>
      compute({
        lesson: baseLesson,
        student: baseStudent,
        teacher: { id: "t-other" },
        currentBalance: 10,
        record: baseRecord,
        publishToParent: true,
      }),
    LessonNotOwnedError,
  );
});

test("compute 学员不存在抛 StudentNotFoundError", () => {
  assert.throws(
    () =>
      compute({
        lesson: baseLesson,
        student: null,
        teacher: baseTeacher,
        currentBalance: 10,
        record: baseRecord,
        publishToParent: true,
      }),
    StudentNotFoundError,
  );
});

test("compute 自定义课时 delta（>1 节课）", () => {
  const out = compute({
    lesson: { ...baseLesson, duration_min: 120 },
    student: baseStudent,
    teacher: baseTeacher,
    currentBalance: 10,
    record: baseRecord,
    publishToParent: true,
  });
  assert.equal(out.lessonTransaction.delta, -2);
  assert.equal(out.newBalance, 8);
});

test("compute summary 包含学习/表现/作业", () => {
  const out = compute({
    lesson: baseLesson,
    student: baseStudent,
    teacher: baseTeacher,
    currentBalance: 10,
    record: { content: "C", performance: "P", homework: "H" },
    publishToParent: true,
  });
  assert.match(out.parentFeed.summary, /学习：C/);
  assert.match(out.parentFeed.summary, /表现：P/);
  assert.match(out.parentFeed.summary, /作业：H/);
});

// ---------- 课酬快照 ----------
// 课节上的 pay_rate / pay_amount 是「消课当刻」的冻结值；缺了它课酬结算就恒为 0。

test("compute 有单价时把课酬冻结成快照", () => {
  const out = compute({
    lesson: baseLesson, // duration_min: 60
    student: baseStudent,
    teacher: { id: "t-1", hourlyPay: 220 },
    currentBalance: 10,
    record: baseRecord,
    publishToParent: false,
  });
  assert.equal(out.lessonUpdate.pay_rate, 220);
  assert.equal(out.lessonUpdate.pay_amount, 220);
});

test("compute 按实际时长折算课酬（90 分钟 × 200/h = 300）", () => {
  const out = compute({
    lesson: { ...baseLesson, duration_min: 90 },
    student: baseStudent,
    teacher: { id: "t-1", hourlyPay: 200 },
    currentBalance: 10,
    record: baseRecord,
    publishToParent: false,
  });
  assert.equal(out.lessonUpdate.pay_rate, 200);
  assert.equal(out.lessonUpdate.pay_amount, 300);
});

test("compute 单价为 0/缺失时不写快照（留给视图按当前单价兜底）", () => {
  const teachers = [{ id: "t-1" }, { id: "t-1", hourlyPay: 0 }, { id: "t-1", hourlyPay: null }];
  for (const teacher of teachers) {
    const out = compute({
      lesson: baseLesson,
      student: baseStudent,
      teacher,
      currentBalance: 10,
      record: baseRecord,
      publishToParent: false,
    });
    assert.equal("pay_rate" in out.lessonUpdate, false);
    assert.equal("pay_amount" in out.lessonUpdate, false);
  }
});
