const store = require('./secureStore.js');
function cutoff(lesson, hours = 0) {
  const start = Date.parse(lesson.scheduled_at);
  return { start, deadline: start - Math.round(Number(hours || 0) * 60) * 60000 };
}
function onTime(lesson, hours, at = Date.now()) {
  const { start, deadline } = cutoff(lesson, hours);
  return Number.isFinite(start) && at < start && at <= deadline;
}
async function remember(request, lesson, hours, submittedAt) {
  if (!store.ready()) return;
  await store.change(`private/leave-policy/${request.id}`, null, old => old || {
    lessonId: lesson.id, hours, submittedAt, scheduledAt: lesson.scheduled_at,
    onTime: onTime(lesson, hours, submittedAt),
  });
}
async function eligible(request, lesson, hours) {
  if (request?.status === 'approved') return true; // Historical approved results stay intact.
  if (store.ready()) {
    const snapshot = (await store.read(`private/leave-policy/${request.id}`, null)).value;
    if (snapshot) return snapshot.onTime === true;
  }
  return onTime(lesson, hours, Date.parse(request.created_at));
}
function message(hours) {
  return `请假最晚须在上课前 ${Math.round(Number(hours) * 60)} 分钟提交；已超过截止时间，未上课将按缺勤登记，扣课时及教师课酬由管理员逐节确认。`;
}
module.exports = { cutoff, onTime, remember, eligible, message };
