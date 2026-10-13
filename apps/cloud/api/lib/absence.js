const store = require("./secureStore.js");
const { getAdmin } = require("./supabase.js");
const { restInsert, restPatch } = require("./rest.js");
const { HttpError } = require("./errors.js");
const key = (id) => `private/attendance-results/${id}`;
async function get(id) {
  return store.ready() ? (await store.read(key(id), null)).value : null;
}
async function register(req, lesson, input) {
  if (!store.ready())
    throw new HttpError(503, "ATTENDANCE_STORAGE", "缺席扣课时的防重存储暂不可用，请稍后重试");
  const choice = {
    deduct_hours: input.deduct_hours,
    reason: input.reason?.trim() || "",
    ...(input.pay_teacher === undefined ? {} : { pay_teacher: input.pay_teacher }),
    ...(input.review_required === undefined ? {} : { review_required: input.review_required }),
  };
  const paysTeacher = input.pay_teacher !== false;
  const fingerprint = await store.hash(JSON.stringify(choice));
  const previous = await get(lesson.id);
  if (previous && previous.fingerprint !== fingerprint)
    throw new HttpError(
      409,
      "ATTENDANCE_CHANGED",
      "已有缺席记录，请按原选择重试，不可重复修改扣课决定",
    );
  if (previous?.state === "done") return { ...previous.result, alreadyRecorded: true };
  if (lesson.status !== "scheduled" && !(lesson.status === "no_show" && previous))
    throw new HttpError(409, "ATTENDANCE_DONE", "该课节已处理，不能重复扣课时");
  let pay = previous?.pay;
  if (!pay) {
    const teacher = await getAdmin()
      .from("teachers")
      .select("*")
      .eq("profile_id", lesson.teacher_id)
      .maybeSingle();
    if (teacher.error || !teacher.data)
      throw new HttpError(503, "PAYROLL_UNAVAILABLE", "教师课酬资料暂时无法确认");
    pay = await require("./payrollPricing.js").snapshot(lesson, teacher.data);
  }
  if (!Number.isFinite(Number(pay.amount)) || Number(pay.amount) < 0)
    throw new HttpError(503, "PAYROLL_UNAVAILABLE", "教师课酬无效");
  await store.change(require("./payrollPricing.js").snapshotKey(lesson.id), null, (old) => ({
    ...old,
    absence_deduct_hours: input.deduct_hours,
    student_amount: input.deduct_hours ? (old?.student_amount ?? null) : 0,
  }));
  const hours = input.deduct_hours ? Math.round((Number(lesson.duration_min) / 60) * 100) / 100 : 0;
  if (!Number.isFinite(hours) || hours < 0)
    throw new HttpError(400, "ATTENDANCE_DURATION", "课节时长无效");
  const hex = await store.hash(`absence-consume:${lesson.id}`);
  const txId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  if (hours > 0) {
    const existing = await getAdmin()
      .from("lesson_transactions")
      .select("id,delta,student_id,lesson_id")
      .eq("id", txId)
      .maybeSingle();
    if (existing.error) throw new HttpError(503, "ATTENDANCE_UNAVAILABLE", "扣课记录读取失败");
    if (
      existing.data &&
      (existing.data.student_id !== lesson.student_id ||
        existing.data.lesson_id !== lesson.id ||
        Number(existing.data.delta) !== -hours)
    )
      throw new HttpError(409, "ATTENDANCE_CHANGED", "原扣课记录不一致，请联系管理员核对");
    if (!existing.data) {
      const balance = await getAdmin()
        .from("student_balance")
        .select("remaining_hours")
        .eq("student_id", lesson.student_id)
        .maybeSingle();
      if (balance.error || !balance.data)
        throw new HttpError(503, "BALANCE_UNAVAILABLE", "课时余额读取失败，未扣课时");
      if (!Number.isFinite(Number(balance.data.remaining_hours)))
        throw new HttpError(503, "BALANCE_UNAVAILABLE", "余额无效，未扣课时");
      if (Number(balance.data.remaining_hours) < hours)
        throw new HttpError(422, "INSUFFICIENT_HOURS", "剩余课时不足，请先补充课时或选择不扣课时");
      await store.change(
        key(lesson.id),
        null,
        (old) =>
          old || {
            state: "pending",
            fingerprint,
            choice,
            pay,
            teacher_id: lesson.teacher_id,
            student_id: lesson.student_id,
            tx_id: txId,
            at: new Date().toISOString(),
          },
      );
      try {
        const inserted = await restInsert("lesson_transactions", {
          id: txId,
          student_id: lesson.student_id,
          lesson_id: lesson.id,
          delta: -hours,
          reason: "consume",
          note: `缺席扣课时：${choice.reason}`,
          created_by: req.context.userId,
        });
        if (!inserted?.length) throw new Error("empty transaction");
      } catch {
        throw new HttpError(
          503,
          "ATTENDANCE_PENDING",
          "扣课结果尚未确认，请保持原选择重试；同一课节不会重复扣课时",
        );
      }
    }
  }
  await store.change(
    key(lesson.id),
    null,
    (old) =>
      old || {
        state: "pending",
        fingerprint,
        choice,
        pay,
        teacher_id: lesson.teacher_id,
        student_id: lesson.student_id,
        at: new Date().toISOString(),
      },
  );
  if (lesson.status === "scheduled") {
    try {
      const updated = await restPatch(
        "lessons",
        { id: lesson.id, status: "scheduled" },
        {
          status: "no_show",
          pay_rate: paysTeacher ? pay.hourly_pay : 0,
          pay_amount: paysTeacher ? pay.amount : 0,
          absence_review_status: input.review_required ? "pending" : "confirmed",
          absence_deduct_hours: input.review_required ? null : input.deduct_hours,
          absence_pay_teacher: input.review_required ? null : paysTeacher,
          absence_reviewed_by: input.review_required ? null : req.context.userId,
          absence_reviewed_at: input.review_required ? null : new Date().toISOString(),
        },
      );
      if (!updated?.length) throw new Error("empty lesson update");
    } catch {
      throw new HttpError(
        503,
        "ATTENDANCE_PENDING",
        "考勤状态尚未确认，请按原选择重试，已写入的扣课流水不会重复写入",
      );
    }
  }
  const result = {
    status: "no_show",
    deduct_hours: choice.deduct_hours,
    deducted_hours: hours,
    teacher_pay_amount: paysTeacher ? pay.amount : 0,
    review_status: input.review_required ? "pending" : "confirmed",
    teacher_pay_currency: pay.currency,
  };
  await store.change(key(lesson.id), null, (current) => ({
    ...current,
    state: "done",
    result,
    completed_at: new Date().toISOString(),
  }));
  return result;
}
module.exports = { register, get };
