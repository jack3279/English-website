const { z } = require("zod");
const { getAdmin } = require("./supabase.js");
const { HttpError } = require("./errors.js");
const { restInsert, restPatch } = require("./rest.js");
const store = require("./secureStore.js");
const { withLock } = require("./workflowLock.js");
const Input = z
  .object({
    mode: z.enum(["content", "attendance"]).default("content"),
    request_id: z.string().uuid(),
    content: z.string().trim().min(1).max(5000),
    expected_hash: z.string().length(64),
    reason: z.string().trim().max(500).default(""),
    result: z.enum(["attended", "no_show"]).optional(),
    deduct_hours: z.boolean().optional(),
    pay_teacher: z.boolean().optional(),
    current_password: z.string().max(128).optional(),
  })
  .strict();
const key = (id) => `private/lesson-corrections/${id}`;
async function one(table, column, id) {
  const r = await getAdmin().from(table).select("*").eq(column, id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
async function get(id) {
  return store.ready() ? (await store.read(key(id), null)).value : null;
}
async function authorize(req, id) {
  const lesson = await one("lessons", "id", id);
  if (!lesson) throw new HttpError(404, "NOT_FOUND", "课节不存在");
  if (
    !["admin", "teacher"].includes(req.context.role) ||
    (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId)
  )
    throw new HttpError(403, "FORBIDDEN", "只能更正自己的课程内容");
  if (!store.ready()) throw new HttpError(503, "CORRECTION_STORAGE", "更正记录存储暂不可用");
  const roll = (await store.read(`private/roll-call/${id}`, null)).value;
  const absence = await require("./absence.js").get(id);
  if (roll?.state === "pending" || absence?.state === "pending")
    throw new HttpError(409, "ATTENDANCE_PENDING", "请先完成原点名提交，再进行更正");
  return lesson;
}
async function settlementGuard(lesson) {
  const day = require("./payrollPricing.js").dayOf(lesson.scheduled_at);
  const records = (await store.read("private/payroll-settlements/state-v1", {})).value;
  if (
    Object.values(records).some(
      (r) =>
        r.teacher_id === lesson.teacher_id &&
        r.state === "paid" &&
        (r.lesson_ids?.includes(lesson.id) ||
          (r.from && r.from <= day && r.to >= day) ||
          (r.month && r.month === day.slice(0, 7))),
    )
  )
    throw new HttpError(
      409,
      "PAYROLL_SETTLED",
      "该课节所在周期已登记发放。请先核对并撤销对应发放登记，或仅更正上课内容",
    );
}
async function plan(req, id, input) {
  const lesson = await authorize(req, id),
    record = await one("records", "lesson_id", id);
  const mode = input.mode || "content";
  if (mode === "content") {
    if (!record) throw new HttpError(409, "RECORD_MISSING", "尚无上课记录，请先完成点名");
    const before = { status: lesson.status, record_id: record.id, content: record.content || "" };
    return {
      mode,
      before,
      expected_hash: await store.hash(JSON.stringify(before)),
      student_id: lesson.student_id,
      teacher_id: lesson.teacher_id,
      record_id: record.id,
      hour_change: 0,
      pay_before: Number(lesson.pay_amount || 0),
      pay_after: Number(lesson.pay_amount || 0),
    };
  }
  if (req.context.role !== "admin")
    throw new HttpError(403, "FORBIDDEN", "考勤及结算更正仅限管理员");
  if (lesson.history_settled) throw new HttpError(409,'HISTORY_SETTLED','历史已结清课程仅允许更正上课内容，不能重新扣课或计酬');
  if (!["completed", "no_show"].includes(lesson.status))
    throw new HttpError(
      409,
      "CORRECTION_STATUS",
      "请假及补课关联记录请通过请假与补课流程处理；此处仅更正上课或缺勤",
    );
  await settlementGuard(lesson);
  const result = input.result || (lesson.status === "completed" ? "attended" : "no_show");
  const deduct =
    result === "attended" ||
    (input.deduct_hours ??
      (await require("./institutionSettings.js").getSettings()).absenceDeductHours);
  const rows = await getAdmin().from("lesson_transactions").select("*").eq("lesson_id", id);
  if (rows.error) throw rows.error;
  const net = (rows.data || [])
    .filter((r) => ["consume", "adjust"].includes(r.reason))
    .reduce((n, r) => n + Number(r.delta), 0);
  if (!Number.isFinite(net)) throw new HttpError(503, "BALANCE_UNAVAILABLE", "原扣课流水无效");
  const hours = Math.round((Number(lesson.duration_min) / 60) * 100) / 100;
  const desired = deduct ? -hours : 0,
    change = Math.round((desired - net) * 100) / 100;
  const balance = await one("student_balance", "student_id", lesson.student_id);
  if (!balance || !Number.isFinite(Number(balance.remaining_hours)))
    throw new HttpError(503, "BALANCE_UNAVAILABLE", "余额暂时无法确认");
  if (Number(balance.remaining_hours) + change < 0)
    throw new HttpError(
      422,
      "INSUFFICIENT_HOURS",
      "更正后课时余额不足，请先补充课时或选择不扣课时",
    );
  const pricing = require("./payrollPricing.js"),
    teacher = await one("teachers", "profile_id", lesson.teacher_id);
  if (!teacher) throw new HttpError(503, "PAYROLL_UNAVAILABLE", "教师计价资料暂时无法确认");
  const frozen = (await store.read(pricing.snapshotKey(id), null)).value;
  const price =
    frozen && !frozen.legacy
      ? frozen
      : pricing.resolve(lesson, teacher, (await pricing.config()).teachers[lesson.teacher_id]);
  const payTeacher =
    result === "attended" ||
    (input.pay_teacher ??
      (await require("./institutionSettings.js").getSettings()).absencePayTeacher);
  const rate = Number(price.base_hourly_pay ?? price.hourly_pay),
    potentialAmount =
      frozen && !frozen.legacy
        ? Number(frozen.base_amount ?? frozen.amount)
        : Math.round(rate * hours * 100) / 100;
  const amount = payTeacher ? potentialAmount : 0;
  if (!Number.isFinite(amount) || amount < 0)
    throw new HttpError(503, "PAYROLL_UNAVAILABLE", "课酬快照无效");
  const before = {
    status: lesson.status,
    content: record?.content || "",
    net_hours: net,
    absence_review_status: lesson.absence_review_status,
    absence_deduct_hours: lesson.absence_deduct_hours,
    absence_pay_teacher: lesson.absence_pay_teacher,
    pay_amount: Number(lesson.pay_amount || 0),
    record_id: record?.id || null,
  };
  return {
    mode,
    before,
    expected_hash: await store.hash(
      JSON.stringify({
        before,
        result,
        deduct,
        payTeacher,
        amount,
        rate,
        currency: price.currency || teacher.pay_currency || "PHP",
      }),
    ),
    student_id: lesson.student_id,
    teacher_id: lesson.teacher_id,
    student_price: price.student_price ?? null,
    prior_snapshot: frozen,
    record_id: record?.id || null,
    hour_change: change,
    deducted_hours: deduct ? hours : 0,
    pay_before: before.pay_amount,
    pay_after: amount,
    pay_rate: payTeacher ? rate : 0,
    base_hourly_pay: rate,
    base_amount: potentialAmount,
    pay_teacher: payTeacher,
    currency: price.currency || teacher.pay_currency || "PHP",
    target_status: result === "attended" ? "completed" : "no_show",
    result,
    deduct_hours: deduct,
    balance_after: Math.round((Number(balance.remaining_hours) + change) * 100) / 100,
  };
}
async function preview(req, id, input = {}) {
  await authorize(req, id);
  const active = await get(id);
  if (
    active?.state === "pending" &&
    req.context.role !== "admin" &&
    (active.input.mode === "attendance" || active.actor !== req.context.userId)
  )
    throw new HttpError(409, "CORRECTION_PENDING", "管理员有一笔更正尚未完成，请联系管理员");
  if (active?.state === "pending") return { ...active.plan, pending: { ...active.input } };
  return plan(req, id, input);
}
async function stableId(value) {
  const h = await store.hash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function save(req, id, body) {
  const checked = Input.safeParse(body);
  if (!checked.success) throw new HttpError(400, "CORRECTION_INVALID", "请核对更正内容与当前记录");
  const { current_password, ...input } = checked.data;
  return withLock(`lesson-${id}`, async () => {
    const lesson = await authorize(req, id);
    if (input.mode === "attendance") {
      if (req.context.role !== "admin") throw new HttpError(403, "FORBIDDEN", "考勤更正仅限管理员");
      if (!input.result || input.reason.length < 2)
        throw new HttpError(400, "CORRECTION_REASON", "考勤更正须填写原因");
      await require("./adminConfirmation.js").verify(req, current_password || "");
    }
    const fingerprint = await store.hash(JSON.stringify(input));
    let active = await get(id);
    if (
      active?.state === "pending" &&
      req.context.role !== "admin" &&
      active.actor !== req.context.userId
    )
      throw new HttpError(409, "CORRECTION_PENDING", "上一笔更正须由原提交人或管理员完成");
    if (active?.input.request_id === input.request_id) {
      if (active.fingerprint !== fingerprint)
        throw new HttpError(409, "CORRECTION_CHANGED", "请保持原更正内容重试");
      if (active.state === "done") return { ...active.result, alreadyRecorded: true };
    } else {
      if (active?.state === "pending")
        throw new HttpError(409, "CORRECTION_PENDING", "上一笔更正未完成，请先恢复原提交");
      const p = await plan(req, id, input);
      if (p.expected_hash !== input.expected_hash)
        throw new HttpError(409, "CORRECTION_STALE", "记录已变化，请刷新并重新核对");
      active = {
        state: "pending",
        input,
        fingerprint,
        plan: p,
        actor: req.context.userId,
        at: new Date().toISOString(),
        record_id: p.record_id || (await stableId("correction-record:" + input.request_id)),
      };
      await store.change(key(id), null, () => active);
    }
    return withLock(`teacher-payroll-${lesson.teacher_id}`, () =>
      withLock(`student-${lesson.student_id}`, async () => {
        const p = active.plan;
        if (input.mode === "attendance") {
          // Recheck settlements on retries too: never amend an already-paid period.
          await settlementGuard(lesson);
          if (p.hour_change !== 0) {
            const txId = await stableId("correction-hours:" + input.request_id);
            const prior = await one("lesson_transactions", "id", txId);
            if (prior) {
              if (
                prior.student_id !== lesson.student_id ||
                prior.lesson_id !== id ||
                Number(prior.delta) !== p.hour_change
              )
                throw new HttpError(409, "CORRECTION_CHANGED", "原更正流水不一致");
            } else {
              const bal = await one("student_balance", "student_id", lesson.student_id);
              if (!bal || Number(bal.remaining_hours) + p.hour_change < 0)
                throw new HttpError(422, "INSUFFICIENT_HOURS", "课时余额已变化，请联系管理员核对");
              const written = await restInsert("lesson_transactions", {
                id: txId,
                student_id: lesson.student_id,
                lesson_id: id,
                delta: p.hour_change,
                reason:
                  p.before.absence_review_status === "pending" && p.hour_change < 0
                    ? "consume"
                    : "adjust",
                note:
                  (p.before.absence_review_status === "pending" ? "缺勤扣课时：" : "点名更正：") +
                  input.reason,
                created_by: req.context.userId,
              });
              if (!written.length)
                throw new HttpError(503, "CORRECTION_PENDING", "课时更正未确认，请按原内容重试");
            }
          }
          const updated = await restPatch(
            "lessons",
            { id },
            {
              status: p.target_status,
              pay_rate: p.pay_rate,
              pay_amount: p.pay_after,
              absence_review_status: p.target_status === "no_show" ? "confirmed" : null,
              absence_deduct_hours: p.target_status === "no_show" ? p.deduct_hours : null,
              absence_pay_teacher: p.target_status === "no_show" ? p.pay_teacher : null,
              absence_reviewed_by: req.context.userId,
              absence_reviewed_at: new Date().toISOString(),
            },
          );
          if (!updated.length)
            throw new HttpError(503, "CORRECTION_PENDING", "考勤状态更正未确认，请重试");
          await store.change(require("./payrollPricing.js").snapshotKey(id), null, (old) =>
            old?.correction_request_id === input.request_id
              ? null
              : {
                  ...old,
                  teacher_id: lesson.teacher_id,
                  student_id: lesson.student_id,
                  course_id: lesson.course_id,
                  scheduled_at: lesson.scheduled_at,
                  duration_min: lesson.duration_min,
                  hourly_pay: p.pay_rate,
                  base_hourly_pay: p.base_hourly_pay,
                  base_amount: p.base_amount,
                  amount: p.pay_after,
                  currency: p.currency,
                  student_price: p.student_price,
                  student_amount: p.deduct_hours
                    ? p.student_price == null
                      ? null
                      : Math.round(((p.student_price * Number(lesson.duration_min)) / 60) * 100) /
                        100
                    : 0,
                  absence_deduct_hours: p.deduct_hours,
                  correction_request_id: input.request_id,
                  legacy: false,
                },
          );
        }
        let record = await one("records", "lesson_id", id);
        if (!record) {
          const written = await restInsert("records", {
            id: active.record_id,
            lesson_id: id,
            content: input.content,
            performance: "",
            homework: "",
            next_plan: "",
            created_by: req.context.userId,
          });
          record = written[0];
          if (!record) throw new HttpError(503, "CORRECTION_PENDING", "上课记录未确认，请重试");
        } else {
          const updated = await restPatch("records", { id: record.id }, { content: input.content });
          if (!updated.length) throw new HttpError(503, "CORRECTION_PENDING", "上课内容更正未确认");
          record = { ...record, content: input.content };
        }
        const summary = require("@cloud/domain").buildSummary(record);
        const feed = await one("parent_feeds", "record_id", record.id);
        if (feed) {
          const updated = await restPatch("parent_feeds", { id: feed.id }, { summary });
          if (!updated.length)
            throw new HttpError(
              503,
              "CORRECTION_PENDING",
              "家长上课记录同步未确认，请按原内容重试",
            );
        } else if (input.mode === "attendance") {
          const written = await restInsert("parent_feeds", {
            id: await stableId("correction-feed:" + input.request_id),
            record_id: record.id,
            student_id: lesson.student_id,
            summary,
          });
          if (!written.length)
            throw new HttpError(503, "CORRECTION_PENDING", "家长记录未确认，请重试");
        }
        const actualBalance =
          input.mode === "attendance"
            ? await one("student_balance", "student_id", lesson.student_id)
            : null;
        if (input.mode === "attendance")
          await store.change(`private/attendance-correction/${id}`, null, () => ({
            status: p.target_status,
            request_id: input.request_id,
            choice: { deduct_hours: p.deduct_hours, reason: input.reason },
            result: {
              status: p.target_status,
              deduct_hours: p.deduct_hours,
              deducted_hours: p.deducted_hours,
              teacher_pay_amount: p.pay_after,
              teacher_pay_currency: p.currency,
            },
          }));
        const result = {
          ...p,
          ...(actualBalance ? { balance_after: Number(actualBalance.remaining_hours) } : {}),
          content: input.content,
          record_id: record.id,
          corrected: true,
        };
        await store.change(
          `private/lesson-correction-history/${id}/${input.request_id}`,
          null,
          () => ({ ...active, state: "done", result, completed_at: new Date().toISOString() }),
        );
        await store.change(key(id), null, () => ({ ...active, state: "done", result }));
        await require("./audit.js").record(
          req.context.userId,
          "lesson.correction",
          "lesson",
          id,
          {
            request_id: input.request_id,
            mode: input.mode,
            reason: input.reason,
            before: p.before,
            hour_change: p.hour_change,
            pay_after: p.pay_after,
          },
          req.reqId,
        );
        return result;
      }),
    );
  });
}
module.exports = { get, preview, save };
