const store = require("./secureStore.js");
const { getAdmin } = require("./supabase.js");
const { HttpError } = require("./errors.js");
const { z } = require("zod");
const KEY = "private/payroll-settlements/state-v1";
const Input = z
  .object({
    teacher_id: z.string().uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    mode: z.enum(["mark", "retract"]).default("mark"),
    note: z.string().trim().max(200).optional().default(""),
    confirmed: z.literal(true),
    current_password: z.string().min(1).max(128),
    expected_amount_cents: z.number().int().nonnegative().optional(),
    expected_currency: z.string().min(1).max(12).optional(),
  })
  .strict();
async function list(req) {
  const rows = store.ready() ? Object.values(await require('./dataScope.js').filterSalaryRecords((await store.read(KEY, {})).value)) : [];
  return {
    records: rows.filter(
      (r) => req.context.role === "admin" || r.teacher_id === req.context.userId,
    ),
    storageReady: store.ready(),
  };
}
async function saveUnlocked(req, body) {
  const checked = Input.safeParse(body);
  if (!checked.success)
    throw new HttpError(400, "PAYROLL_CONFIRMATION_REQUIRED", "请核对月份并确认实际发放情况");
  const input = checked.data;
  await require("./adminConfirmation.js").verify(req, input.current_password);
  const key = `${input.teacher_id}_${input.month}`,
    now = new Date().toISOString();
  let amount, currency;
  if (input.mode === "mark") {
    if (store.ready() && (await require("./payrollPricing.js").config()).teachers[input.teacher_id])
      throw new HttpError(
        400,
        "PAYROLL_PERIOD_REQUIRED",
        "该教师已启用分课程计价，请使用新版周期统计登记发放",
      );
    const [payroll, teacher] = await Promise.all([
      getAdmin()
        .from("teacher_payroll")
        .select("pay_amount")
        .eq("teacher_id", input.teacher_id)
        .eq("month", `${input.month}-01`),
      getAdmin()
        .from("teachers")
        .select("pay_currency")
        .eq("profile_id", input.teacher_id)
        .maybeSingle(),
    ]);
    if (payroll.error || teacher.error)
      throw new HttpError(503, "PAYROLL_UNAVAILABLE", "课酬资料读取失败");
    if (!teacher.data) throw new HttpError(404, "TEACHER_NOT_FOUND", "教师档案不存在");
    amount = Math.round(
      (payroll.data || []).reduce((n, r) => n + Number(r.pay_amount || 0), 0) * 100,
    );
    currency = teacher.data.pay_currency || "PHP";
    if (!Number.isFinite(amount) || amount <= 0)
      throw new HttpError(400, "PAYROLL_ZERO", "该月份没有应计课酬，无需登记发放");
    if (input.expected_amount_cents == null || !input.expected_currency)
      throw new HttpError(400, "PAYROLL_CONFIRMATION_REQUIRED", "请刷新并核对当前金额后再登记");
    if (input.expected_amount_cents !== amount || input.expected_currency !== currency)
      throw new HttpError(
        409,
        "PAYROLL_CHANGED",
        "当前应计金额或币种已变化，请刷新核对后再确认发放记录",
      );
  } else if (input.note.length < 2)
    throw new HttpError(400, "PAYROLL_NOTE_REQUIRED", "撤销登记请填写原因");
  if(input.mode==='mark'){
    const period=require('./payrollReport.js').periodFor(input.month+'-01','monthly');const win=require('./window.js').parseWindow(period.from,period.to);
    const pending=await getAdmin().from('lessons').select('id').eq('teacher_id',input.teacher_id).eq('absence_review_status','pending').gte('scheduled_at',win.fromIso).lte('scheduled_at',win.toIso).limit(1);
    if(pending.error)throw pending.error;if(Array.isArray(pending.data)&&pending.data.length)throw new HttpError(409,'ABSENCE_REVIEW_PENDING','该月份有缺勤结算待确认，请先处理后再登记发放');
  }
  const changed = await store.change(KEY, {}, (records) => {
    const old = records[key];
    if (input.mode === "mark") {
      const interval = require("./payrollReport.js").periodFor(`${input.month}-01`, "monthly");
      for (const other of Object.values(records)) {
        if (
          other.from &&
          other.state === "paid" &&
          other.teacher_id === input.teacher_id &&
          other.from <= interval.to &&
          other.to >= interval.from
        )
          throw new HttpError(
            409,
            "PAYROLL_OVERLAP",
            "该月份已有周结或分币种发放记录，请使用新版周期统计核对",
          );
      }
    }

    if (input.mode === "mark" && old?.state === "paid") {
      if (old.amount_cents !== amount || old.currency !== currency)
        throw new HttpError(
          409,
          "PAYROLL_CHANGED",
          "已有发放登记，当前金额或币种发生变化，请先核对后撤销登记",
        );
      return null;
    }
    if (input.mode === "retract" && old?.state !== "paid")
      throw new HttpError(409, "PAYROLL_NOT_PAID", "当前没有可撤销的发放登记");
    const history = old
      ? [
          ...(old.history || []),
          Object.fromEntries(Object.entries(old).filter(([field]) => field !== "history")),
        ]
      : [];
    return {
      ...records,
      [key]: {
        teacher_id: input.teacher_id,
        month: input.month,
        amount_cents: amount ?? old.amount_cents,
        currency: currency ?? old.currency,
        state: input.mode === "mark" ? "paid" : "retracted",
        at: now,
        actor: req.context.userId,
        note: input.note,
        history,
      },
    };
  });
  const record = changed?.[key] || (await store.read(KEY, {})).value[key];
  if (changed) {
    await require("./audit.js").record(
      req.context.userId,
      `payroll.${input.mode}`,
      "teacher",
      input.teacher_id,
      { month: input.month, amount_cents: record.amount_cents, currency: record.currency },
      req.reqId,
    );
    await require("./notify.js").push(
      {
        type: "system",
        target_user: input.teacher_id,
        title: input.mode === "mark" ? "课酬发放已登记" : "课酬发放登记已撤销",
        body: `${input.month} · ${(record.amount_cents / 100).toFixed(2)} ${record.currency}。此消息为登记记录，实际到账请自行核对。`,
        link: "/teacher/payroll",
      },
      { source: "payroll.settlement", reqId: req.reqId },
    );
  }
  return record;
}
async function save(req,body){return require('./workflowLock.js').withLock(`teacher-payroll-${body?.teacher_id||'invalid'}`,()=>saveUnlocked(req,body));}
module.exports = { list, save };
