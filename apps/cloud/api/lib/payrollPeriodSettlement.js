const store = require("./secureStore.js");
const { HttpError } = require("./errors.js");
const { z } = require("zod");
const { report, periodFor } = require("./payrollReport.js");
const KEY = "private/payroll-settlements/state-v1";
const inputSchema = z
  .object({
    teacher_id: z.string().uuid(),
    period: z.enum(["weekly", "monthly"]),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(["mark", "retract"]).default("mark"),
    note: z.string().trim().max(200).default(""),
    confirmed: z.literal(true),
    current_password: z.string().min(1).max(128),
    expected_amount_cents: z.number().int().nonnegative(),
    expected_currency: z.enum(require("./payrollPricing.js").currencies),
  })
  .strict();
async function saveUnlocked(req, body) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(400, "PAYROLL_CONFIRMATION_REQUIRED", "请核对周期、币种及金额");
  const v = parsed.data;
  if (
    [v.from, v.to].some(
      (d) => Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d,
    )
  )
    throw new HttpError(400, "PAYROLL_PERIOD", "日期无效");
  const canonical = periodFor(v.from, v.period);
  if (canonical.from !== v.from || canonical.to !== v.to)
    throw new HttpError(400, "PAYROLL_PERIOD", "周结必须为周一至周日，月结必须为完整自然月");
  await require("./adminConfirmation.js").verify(req, v.current_password);
  const key = `${v.teacher_id}_${v.period}_${v.from}_${v.to}_${v.expected_currency}`;
  let row;
  if (v.mode === "mark") {
    const result = await report(
      req,
      new URLSearchParams({ teacher_id: v.teacher_id, from: v.from, to: v.to, period: v.period }),
    );
    if(result.pending_absences>0)throw new HttpError(409,"ABSENCE_REVIEW_PENDING","该周期有缺勤结算待确认，请先逐节处理后再登记发放");
    row = result.rows.find((r) => r.pay_currency === v.expected_currency);
    if (!row || Math.round(row.pay_amount * 100) !== v.expected_amount_cents || row.pay_amount <= 0)
      throw new HttpError(409, "PAYROLL_CHANGED", "金额已变化，请刷新后核对完整周期");
  } else if (v.note.length < 2)
    throw new HttpError(400, "PAYROLL_NOTE_REQUIRED", "撤销登记请填写原因");
  const at = new Date().toISOString();
  const changed = await store.change(KEY, {}, (records) => {
    const old = records[key];
    if (v.mode === "retract" && old?.state !== "paid")
      throw new HttpError(409, "PAYROLL_NOT_PAID", "没有可撤销的登记");
    if (v.mode === "mark") {
      for (const [otherKey, other] of Object.entries(records)) {
        if (otherKey === key || other.state !== "paid" || other.teacher_id !== v.teacher_id)
          continue;
        const interval = other.from ? other : periodFor(`${other.month}-01`, "monthly");
        if (
          interval.from <= v.to &&
          interval.to >= v.from &&
          (!other.from || other.currency === v.expected_currency)
        )
          throw new HttpError(
            409,
            "PAYROLL_OVERLAP",
            "该周期与已有发放记录重叠，请先核对并撤销原登记，避免重复发放",
          );
      }
      if (old?.state === "paid") {
        if (
          old.amount_cents !== v.expected_amount_cents ||
          JSON.stringify(old.lesson_ids) !== JSON.stringify(row.lesson_ids)
        )
          throw new HttpError(409, "PAYROLL_CHANGED", "原登记的课程或金额已变化，请先核对原记录");
        return null;
      }
    }
    return {
      ...records,
      [key]: {
        teacher_id: v.teacher_id,
        period: v.period,
        from: v.from,
        to: v.to,
        month: v.period === "monthly" ? v.from.slice(0, 7) : null,
        currency: v.expected_currency,
        amount_cents: v.mode === "mark" ? v.expected_amount_cents : old.amount_cents,
        lesson_ids: row?.lesson_ids || old.lesson_ids,
        state: v.mode === "mark" ? "paid" : "retracted",
        note: v.note,
        actor: req.context.userId,
        at,
        history: old
          ? [
              ...(old.history || []),
              Object.fromEntries(Object.entries(old).filter(([k]) => k !== "history")),
            ]
          : [],
      },
    };
  });
  const record = changed?.[key] || (await store.read(KEY, {})).value[key];
  if (changed)
    await require("./audit.js").record(
      req.context.userId,
      `payroll.${v.mode}`,
      "teacher",
      v.teacher_id,
      { from: v.from, to: v.to, currency: v.expected_currency, amount_cents: record.amount_cents },
      req.reqId,
    );
  return record;
}
async function save(req,body){return require('./workflowLock.js').withLock(`teacher-payroll-${body?.teacher_id||'invalid'}`,()=>saveUnlocked(req,body));}
module.exports = { save };
