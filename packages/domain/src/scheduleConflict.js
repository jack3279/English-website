function overlap(a, b) {
  const aStart = new Date(a.scheduled_at).getTime();
  const aEnd = aStart + a.duration_min * 60_000;
  const bStart = new Date(b.scheduled_at).getTime();
  const bEnd = bStart + b.duration_min * 60_000;
  // [aStart, aEnd) 与 [bStart, bEnd) 重叠
  return aStart < bEnd && bStart < aEnd;
}

function detect({ newLesson, existingLessons }) {
  const conflicts = [];
  for (const ex of existingLessons) {
    if (ex.id === newLesson.id) continue;
    if (ex.status === "cancelled" || ex.status === "no_show") continue;
    if (!overlap(newLesson, ex)) continue;
    if (ex.teacher_id === newLesson.teacher_id) {
      conflicts.push({ type: "teacher", with: ex.id, reason: `与课次 ${ex.id} 老师时间冲突` });
    }
    if (ex.student_id === newLesson.student_id) {
      conflicts.push({ type: "student", with: ex.id, reason: `与课次 ${ex.id} 学员时间冲突` });
    }
  }
  return conflicts;
}

module.exports = { detect, overlap };
