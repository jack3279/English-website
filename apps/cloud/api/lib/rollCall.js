const { z } = require("zod");
const { getAdmin } = require("./supabase.js");
const { requireAuth, requireRole } = require("./auth.js");
const { HttpError } = require("./errors.js");
const { restInsert } = require("./rest.js");
const store = require("./secureStore.js");
const { withLock } = require("./workflowLock.js");
const schema = z.object({
  result: z.enum(["attended", "leave", "no_show"]),
  content: z.string().trim().min(1).max(5000),
  reason: z.string().trim().max(500).default(""),
  deduct_hours: z.boolean().optional(),
  pay_teacher: z.boolean().optional(),
});
async function one(table, key, id) {
  const r = await getAdmin().from(table).select("*").eq(key, id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
async function ensure(table, key, id, row) {
  const old = await one(table, key, id);
  if (old) return old;
  try {
    const rows = await restInsert(table, row);
    if (!rows?.length) throw new Error("Record insert not confirmed");
    return rows[0];
  } catch (e) {
    const recovered = await one(table, key, id);
    if (recovered) return recovered;
    throw e;
  }
}
async function run(req, res, id, handlers) {
  await requireAuth(req, res);
  requireRole(req, res, "admin", "teacher");
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    throw new HttpError(400, "ROLL_CALL_CONTENT", "请选择点名结果并填写本节课内容");
  const v = parsed.data;

  if (!store.ready())
    throw new HttpError(503, "ROLL_CALL_STORAGE", "点名防重存储暂不可用，请稍后重试");
  return withLock(`lesson-${id}`, async () => {
    const l = await one("lessons", "id", id);
    if (!l) throw new HttpError(404, "NOT_FOUND", "课节不存在");
    if (req.context.role === "teacher" && l.teacher_id !== req.context.userId)
      throw new HttpError(403, "FORBIDDEN", "只能给自己的课程点名");
    const key = `private/roll-call/${id}`;
    let intent = (await store.read(key, null)).value;
    const settings = await require("./institutionSettings.js").getSettings();
    let lateLeave = false;
    if (intent?.input?.late_leave) {
      lateLeave = true;
      v.late_leave = true;
      if (v.result === 'leave') v.result = 'no_show';
    }
    if (!intent && v.result === 'leave' && l.status === 'scheduled') {
      const policy = require('./leavePolicy.js');
      let timely = policy.onTime(l, settings.leaveDeadlineHours);
      if (l.leave_status === 'pending') {
        const pending = await getAdmin().from('leave_requests').select('*').eq('lesson_id', id).eq('status', 'pending').maybeSingle();
        if (pending.error || !pending.data) throw new HttpError(409, 'LEAVE_PENDING', '请假记录未确认，请联系管理员');
        timely = await policy.eligible(pending.data, l, settings.leaveDeadlineHours);
        if (!timely) throw new HttpError(409, 'LEAVE_PENDING', '请先处理超时的请假申请，再登记缺勤');
      }
      if (!timely) {
        if (Date.parse(l.scheduled_at) + Number(l.duration_min) * 60000 > Date.now())
          throw new HttpError(400, 'LEAVE_DEADLINE', '已超过请假截止时间；未上课将按缺勤处理，请下课后登记缺勤');
        v.result = 'no_show';
        lateLeave = true;
        v.late_leave = true;
      }
    }
    if (v.result === "no_show") {
      if (intent) {
        v.deduct_hours = intent.input.deduct_hours;
        v.pay_teacher = intent.input.pay_teacher;
        v.review_required = intent.input.review_required;
      } else {
        v.review_required = req.context.role === "teacher" || lateLeave;
        v.deduct_hours = v.review_required
          ? false
          : (v.deduct_hours ?? settings.absenceDeductHours);
        v.pay_teacher = v.review_required ? false : (v.pay_teacher ?? settings.absencePayTeacher);
      }
    } else {
      v.deduct_hours = false;
      delete v.pay_teacher;
      delete v.review_required;
    }
    if ((v.result === "leave" || (v.result === "no_show" && v.deduct_hours)) && !v.reason)
      throw new HttpError(400, "ROLL_CALL_REASON", "请填写请假或扣课时原因");
    const fingerprint = await store.hash(
      JSON.stringify({
        result: v.result,
        content: v.content,
        reason: v.reason,
        deduct_hours: v.deduct_hours,
        ...(v.pay_teacher === undefined ? {} : { pay_teacher: v.pay_teacher }),
        ...(v.review_required === undefined ? {} : { review_required: v.review_required }),
        ...(v.late_leave ? { late_leave: true } : {}),
      }),
    );
    if (intent && intent.fingerprint !== fingerprint)
      throw new HttpError(409, "ROLL_CALL_CHANGED", "已有点名提交，请保持原选项及内容重试");
    if (intent?.state === "done") {
      res.status(200).json({ data: { ...intent.result, alreadyRecorded: true } });
      return;
    }
    if (!intent && l.status !== "scheduled")
      throw new HttpError(409, "ROLL_CALL_DONE", "这节课已有考勤结果，请查看上课记录");
    if (v.result !== "leave" && Date.parse(l.scheduled_at) + l.duration_min * 60000 > Date.now())
      throw new HttpError(400, "CLASS_NOT_ENDED", "课程尚未结束，请下课后点名");
    intent =
      intent ||
      (await store.change(
        key,
        null,
        (old) =>
          old || {
            fingerprint,
            input: v,
            state: "pending",
            record_id: crypto.randomUUID(),
            feed_id: crypto.randomUUID(),
          },
      ));
    let output;
    const proxy = {
      status(n) {
        this.code = n;
        return this;
      },
      code: 200,
      json(b) {
        output = b;
        return this;
      },
      setHeader() {},
    };
    const previousBody = req.body;
    req.__lessonLock = true;
    try {
      if (v.result === "attended") {
        req.body = {
          content: v.content,
          performance: "",
          homework: "",
          next_plan: "",
          publishToParent: true,
          attendanceOnly: true,
        };
        await handlers.complete(req, proxy, id);
      } else if (
        l.status === "scheduled" ||
        (v.result === "no_show" && (await require("./absence.js").get(id))?.state !== "done")
      ) {
        req.body = {
          result: v.result,
          reason: v.reason,
          deduct_hours: v.deduct_hours,
          pay_teacher: v.pay_teacher,
          review_required: v.review_required,
        };
        req.__lateLeave = lateLeave || intent.input?.review_required === true;
        try { await handlers.attendance(req, proxy, id); } finally { delete req.__lateLeave; }
      } else if (
        v.result === "leave" &&
        l.status === "cancelled" &&
        l.leave_status === "approved"
      ) {
        const leave = await getAdmin()
          .from("leave_requests")
          .select("*")
          .eq("lesson_id", id)
          .eq("status", "approved")
          .maybeSingle();
        if (leave.error || !leave.data)
          throw new HttpError(409, "LEAVE_PENDING", "请假记录未确认，请联系管理员");
        await require("./makeupWorkflow.js").ensureForLeave(req, l, leave.data.id, v.reason);
      } else if (l.status !== "no_show")
        throw new HttpError(409, "ROLL_CALL_CHANGED", "课程状态已变化，请联系管理员核对");
    } finally {
      req.body = previousBody;
      delete req.__lessonLock;
    }
    if (proxy.code >= 400) {
      res.status(proxy.code).json(output);
      return;
    }
    {
      const record = await ensure("records", "lesson_id", id, {
        id: intent.record_id,
        lesson_id: id,
        content: v.content,
        performance: "",
        homework: "",
        next_plan: "",
        created_by: req.context.userId,
      });
      await ensure("parent_feeds", "record_id", record.id, {
        id: intent.feed_id,
        record_id: record.id,
        student_id: l.student_id,
        summary: v.content,
      });
    }
    const result = {
      ...(output?.data || {}),
      result: v.result,
      ...(v.late_leave ? { classified_as_absent: true } : {}),
      content: v.content,
      parentFeedPublished: true,
    };
    await store.change(key, null, (current) => ({
      ...current,
      state: "done",
      result,
      at: new Date().toISOString(),
    }));
    res.status(200).json({ data: result });
  });
}
module.exports = { run };
