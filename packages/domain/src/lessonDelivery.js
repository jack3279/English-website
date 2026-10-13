const {
  InsufficientHoursError,
  LessonAlreadyCompletedError,
  LessonNotOwnedError,
  StudentNotFoundError,
} = require("./errors.js");

function buildSummary(record) {
  const parts = [];
  if (record.content) parts.push(`学习：${record.content}`);
  if (record.performance) parts.push(`表现：${record.performance}`);
  if (record.homework) parts.push(`作业：${record.homework}`);
  return parts.join("；");
}

function compute({ lesson, student, teacher, currentBalance, record, publishToParent }) {
  if (!student) throw new StudentNotFoundError(lesson.student_id);
  if (lesson.teacher_id !== teacher.id) throw new LessonNotOwnedError(lesson.id, teacher.id);
  if (lesson.status !== "scheduled") throw new LessonAlreadyCompletedError(lesson.id);

  const delta = -(lesson.duration_min / 60); // 小时
  if (currentBalance + delta < 0) {
    throw new InsufficientHoursError(student.id, currentBalance);
  }

  const nowIso = new Date().toISOString();

  // 课酬快照: 消课的这一刻把单价与金额冻结在课节上, 之后调单价不影响历史账单。
  // 单价为 0(还没给老师设课酬)时不写快照 —— 留给 teacher_payroll 视图按当前单价兜底,
  // 这样"先上课、后补设单价"的历史课也能正确算钱。
  const payRate = Number(teacher?.hourlyPay ?? 0);
  const paySnapshot =
    payRate > 0
      ? {
          pay_rate: payRate,
          pay_amount: Math.round(((payRate * lesson.duration_min) / 60) * 100) / 100,
        }
      : {};

  return {
    record: {
      lesson_id: lesson.id,
      content: record.content,
      performance: record.performance ?? null,
      homework: record.homework ?? null,
      next_plan: record.next_plan ?? null,
      created_at: nowIso,
    },
    lessonTransaction: {
      student_id: student.id,
      lesson_id: lesson.id,
      delta,
      reason: "consume",
      note: null,
      created_at: nowIso,
    },
    lessonUpdate: {
      id: lesson.id,
      status: "completed",
      completed_at: nowIso,
      ...paySnapshot,
    },
    parentFeed: publishToParent
      ? {
          record_id: null, // 由调用方在 record.id 生成后填入
          student_id: student.id,
          summary: buildSummary(record),
          published_at: nowIso,
        }
      : null,
    newBalance: currentBalance + delta,
  };
}

module.exports = { compute, buildSummary };
