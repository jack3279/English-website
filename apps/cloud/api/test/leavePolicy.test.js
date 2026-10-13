const test = require('node:test'), assert = require('node:assert/strict');
require('./setup.js');
const { StatefulDb, Bucket, uuid } = require('./support/statefulDb.js');
let db;
require.cache[require.resolve('../lib/supabase.js')] = { exports: { getAdmin: () => db.client(), createAuthClient: () => db.client() } };
const policy = require('../lib/leavePolicy.js'), settings = require('../lib/institutionSettings.js'), route = require('../routes/lessons.js');
const teacher = { id: uuid(1), role: 'teacher' }, admin = { id: uuid(2), role: 'admin' }, student = uuid(3), id = uuid(4);
const originalFetch = globalThis.fetch;
test.beforeEach(async () => {
  db = new StatefulDb();
  db.seed('profiles', [teacher, admin]); db.seed('teachers', [{ id: uuid(5), profile_id: teacher.id, hourly_pay: 8, pay_currency: 'USD' }]);
  db.seed('students', [{ id: student, full_name: '模拟学生' }]); db.seed('student_packages', [{ id: uuid(6), student_id: student, remaining_hours: 10 }]);
  db.seed('lessons', [{ id, student_id: student, teacher_id: teacher.id, status: 'scheduled', scheduled_at: new Date(Date.now()-3*3600000).toISOString(), duration_min: 60 }]);
  globalThis.__CLOUDFLARE_ENV = { BACKUP_BUCKET: new Bucket(), ENCRYPTION_KEY: Buffer.alloc(32,32).toString('base64'), SUPABASE_URL: 'https://stateful.invalid', SUPABASE_SERVICE_ROLE_KEY: 'mock' };
  globalThis.fetch = (url, options) => db.fetch(url, options);
  await settings.updateSettings({ leaveDeadlineHours: 2 });
});
test.afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.__CLOUDFLARE_ENV; });
async function call(actor, body) {
  const req = { url: `/${id}/roll-call`, method: 'POST', body, __testUser: actor, headers: { authorization: 'Bearer mock' }, reqId: 'deadline-qa' };
  let status = 200, payload;
  await route(req, { status(n) { status=n; return this; }, json(v) { payload=v; return this; }, setHeader() {} });
  if (status>=400) throw Object.assign(new Error(payload.error), { code: payload.code });
  return payload.data;
}
test('截止时间边界含提前两小时整点，上课后与零小时开课整点均不接受请假', () => {
  const lesson = { scheduled_at: '2026-10-20T11:00:00Z' };
  assert(policy.onTime(lesson, 2, Date.parse('2026-10-20T09:00:00Z')));
  assert(!policy.onTime(lesson, 2, Date.parse('2026-10-20T09:00:00.001Z')));
  assert(!policy.onTime(lesson, 0, Date.parse(lesson.scheduled_at)));
});
test('提前241分钟的截止时刻精确到毫秒，超过一毫秒即超时', () => {
  const lesson = { scheduled_at: '2026-10-20T11:00:00Z' }, at = Date.parse(lesson.scheduled_at)-241*60000;
  assert.equal(policy.cutoff(lesson,241/60).deadline,at);
  assert(policy.onTime(lesson,241/60,at));
  assert(!policy.onTime(lesson,241/60,at+1));
});
test('截止前已提交申请，之后修改规则仍按提交时规则审批及点名', async () => {
  const lesson = db.rows('lessons')[0], at = Date.parse(lesson.scheduled_at)-2*3600000;
  const request = { id: uuid(7), lesson_id: id, student_id: student, status: 'pending', created_at: new Date(at).toISOString() };
  db.rows('leave_requests').push(request); lesson.leave_status='pending';
  await policy.remember(request, lesson, 2, at);
  await settings.updateSettings({ leaveDeadlineHours: 24 });
  assert(await policy.eligible(request, lesson, 24));
  const result = await call(teacher, { result: 'leave', content: 'Unit 1 planned', reason: '提前请假' });
  assert.equal(result.result, 'leave'); assert.equal(lesson.status, 'cancelled'); assert.equal(db.balance(student), 10);
  assert.equal(db.rows('makeups').length, 1);
});
test('未提前请假，教师下课后选择请假自动登记缺勤，重试不重扣不重记', async () => {
  const body = { result: 'leave', content: 'Unit 1 planned', reason: '临时未到' };
  const first = await call(teacher, body), second = await call(teacher, body);
  assert.equal(first.result, 'no_show'); assert(first.classified_as_absent);
  assert(second.alreadyRecorded); assert.equal(db.rows('lessons')[0].absence_review_status, 'pending');
  assert.equal(db.balance(student),10); assert.equal(db.rows('lessons')[0].pay_amount,0);
  assert.equal(db.rows('records').length,1); assert.equal(db.rows('makeups').length,0);
});
test('管理员补记超时请假也转缺勤待确认，不按默认选项立即结算', async () => {
  const result = await call(admin, { result: 'leave', content: 'Unit 1 planned', reason: '临时未到' });
  assert.equal(result.result,'no_show'); assert.equal(db.rows('lessons')[0].absence_review_status,'pending'); assert.equal(db.balance(student),10);
});
test('尚未下课的超时申请被拒绝，不留下锁定的点名意图', async () => {
  db.rows('lessons')[0].scheduled_at = new Date(Date.now()+3600000).toISOString();
  await assert.rejects(call(teacher, { result:'leave', content:'Unit 1 planned', reason:'临时未到' }), { code:'LEAVE_DEADLINE' });
  assert.equal((await require('../lib/secureStore.js').read(`private/roll-call/${id}`,null)).value,null);
  assert.equal(db.rows('lessons')[0].status,'scheduled');
});
