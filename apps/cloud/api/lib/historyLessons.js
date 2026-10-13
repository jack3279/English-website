const { z } = require('zod');
const { getAdmin } = require('./supabase.js');
const { restInsert } = require('./rest.js');
const { HttpError } = require('./errors.js');
const store = require('./secureStore.js');
const { withLock } = require('./workflowLock.js');
const schema = z.object({
  request_id: z.string().uuid(), student_id: z.string().uuid(), teacher_id: z.string().uuid(),
  course_id: z.string().uuid().nullable().optional(), scheduled_at: z.string().datetime({offset:true}),
  duration_min: z.number().int().min(15).max(240), result: z.enum(['attended','leave','no_show']),
  content: z.string().trim().min(1).max(5000), note: z.string().trim().max(500).default(''),
  fees_already_settled: z.literal(true), opening_balance_includes_history: z.literal(true),
  current_password: z.string().min(1),
}).strict();
async function one(table, key, id) {
  const r = await getAdmin().from(table).select('*').eq(key,id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
async function insertOnce(table, key, id, value) {
  const old = await one(table,key,id);
  if (old) return old;
  const rows = await restInsert(table,value);
  if (!rows?.length) throw new HttpError(503,'HISTORY_PENDING','历史记录尚未确认，请保持原内容重试');
  return rows[0];
}
async function save(req, raw) {
  if (req.context.role !== 'admin') throw new HttpError(403,'FORBIDDEN','历史课程补录仅限管理员');
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400,'HISTORY_INPUT','请核对历史课程资料，并确认余额已包含历史消课、课酬已结清');
  const {current_password, ...input} = parsed.data;
  input.scheduled_at = new Date(input.scheduled_at).toISOString();
  if (Date.parse(input.scheduled_at)+input.duration_min*60000 > Date.now()) throw new HttpError(400,'HISTORY_FUTURE','只能补录已经结束的历史课程');
  if (!store.ready()) throw new HttpError(503,'HISTORY_STORAGE','历史记录防重存储暂不可用');
  await require('./adminConfirmation.js').verify(req,current_password);
  const {request_id, ...semantic} = input;
  const fp = await store.hash(JSON.stringify(semantic));
  const event = await store.hash([input.student_id,input.teacher_id,Date.parse(input.scheduled_at)].join('|'));
  return withLock(`history-event-${event}`, async () => {
    let name = `private/history-lessons/${input.request_id}`;
    let journal = (await store.read(name,null)).value;
    if (journal && (journal.fingerprint !== fp || journal.actor !== req.context.userId)) throw new HttpError(409,'HISTORY_CHANGED','已有历史补录提交，请保持原内容重试');
    if (journal?.state === 'done') return {...journal.result,alreadyRecorded:true};
    const student = await one('students','id',input.student_id), teacher = await one('teachers','profile_id',input.teacher_id);
    if (!student || !teacher) throw new HttpError(400,'HISTORY_RELATION','请选择当前范围内的学生和教师');
    if (input.course_id) {
      const course = await one('courses','id',input.course_id);
      if (!course || course.teacher_id !== input.teacher_id || (course.student_id && course.student_id !== input.student_id)) throw new HttpError(400,'HISTORY_COURSE','课程与学生或教师不匹配');
    }
    const duplicate = await getAdmin().from('lessons').select('id,history_settled').eq('student_id',input.student_id).eq('teacher_id',input.teacher_id).eq('scheduled_at',input.scheduled_at).limit(2);
    if (duplicate.error) throw duplicate.error;
    const existing = duplicate.data || [];
    if (existing.some(l=>l.id !== input.request_id)) {
      const previous = existing.length===1 && existing[0].history_settled ? (await store.read(`private/history-lessons/${existing[0].id}`,null)).value : null;
      if (!previous || previous.fingerprint!==fp || previous.actor!==req.context.userId) throw new HttpError(409,'HISTORY_DUPLICATE','同一学生、教师和时间已有课程，请在上课记录中核对');
      input.request_id = existing[0].id; name = `private/history-lessons/${input.request_id}`; journal = previous;
      if (journal.state==='done') return {...journal.result,alreadyRecorded:true};
    }
    const old = await one('lessons','id',input.request_id);
    if (old && !old.history_settled) throw new HttpError(409,'HISTORY_DUPLICATE','该编号已有正常课程，不能覆盖');
    journal ||= await store.change(name,null,()=>({state:'pending',fingerprint:fp,actor:req.context.userId,input,record_id:crypto.randomUUID(),feed_id:crypto.randomUUID()}));
    const status = {attended:'completed',no_show:'no_show',leave:'cancelled'}[input.result];
    await insertOnce('lessons','id',input.request_id,{
      id:input.request_id,student_id:input.student_id,teacher_id:input.teacher_id,course_id:input.course_id||null,
      scheduled_at:input.scheduled_at,duration_min:input.duration_min,status,
      completed_at:new Date(Date.parse(input.scheduled_at)+input.duration_min*60000).toISOString(),
      leave_status:input.result==='leave'?'approved':null,
      pay_rate:0,pay_amount:0,history_settled:true,history_note:input.note||'历史已结清，不重复扣课或计酬',
    });
    const record = await insertOnce('records','lesson_id',input.request_id,{id:journal.record_id,lesson_id:input.request_id,content:input.content,performance:'',homework:'',next_plan:'',created_by:req.context.userId});
    await insertOnce('parent_feeds','record_id',record.id,{id:journal.feed_id,record_id:record.id,student_id:input.student_id,summary:input.content});
    // No ledger, pricing, payroll settlement, makeup, or external reminder is generated.
    const result = {id:input.request_id,status,history_settled:true,student_hours_changed:0,teacher_pay_added:0,parentFeedPublished:true};
    await require('./audit.js').record(req.context.userId,'lesson.history_recorded','lesson',input.request_id,{result:input.result,history_settled:true},req.reqId);
    await store.change(name,null,old=>({...old,state:'done',result}));
    return result;
  });
}
module.exports={save};
