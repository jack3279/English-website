class DomainError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details ?? null;
  }
}

class InsufficientHoursError extends DomainError {
  constructor(studentId, currentBalance) {
    super("INSUFFICIENT_HOURS", `学生 ${studentId} 课时不足（当前 ${currentBalance}h）`, {
      studentId,
      currentBalance,
    });
  }
}

class LessonNotFoundError extends DomainError {
  constructor(lessonId) {
    super("LESSON_NOT_FOUND", `课次 ${lessonId} 不存在`, { lessonId });
  }
}

class LessonNotOwnedError extends DomainError {
  constructor(lessonId, teacherId) {
    super("LESSON_NOT_OWNED", `老师 ${teacherId} 无权操作课次 ${lessonId}`, {
      lessonId,
      teacherId,
    });
  }
}

class LessonAlreadyCompletedError extends DomainError {
  constructor(lessonId) {
    super("LESSON_ALREADY_COMPLETED", `课次 ${lessonId} 已完成`, { lessonId });
  }
}

class StudentNotFoundError extends DomainError {
  constructor(studentId) {
    super("STUDENT_NOT_FOUND", `学员 ${studentId} 不存在`, { studentId });
  }
}

class ScheduleConflictError extends DomainError {
  constructor(conflicts) {
    super("SCHEDULE_CONFLICT", `排课冲突: ${conflicts.map((c) => c.reason).join("; ")}`, {
      conflicts,
    });
  }
}

module.exports = {
  DomainError,
  InsufficientHoursError,
  LessonNotFoundError,
  LessonNotOwnedError,
  LessonAlreadyCompletedError,
  StudentNotFoundError,
  ScheduleConflictError,
};
