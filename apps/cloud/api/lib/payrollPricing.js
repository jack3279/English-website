const store = require("./secureStore.js");
const { getAdmin } = require("./supabase.js");
const { HttpError } = require("./errors.js");
const { z } = require("zod");
const KEY = "private/payroll-pricing/v1";
const currencies = ["PHP", "USD", "CNY", "EUR", "GBP", "CAD", "AUD"];
const money = z
  .number()
  .finite()
  .min(0)
  .max(1000000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "金额最多两位小数");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const ruleSchema = z
  .object({
    id: z.string().max(80).optional(),
    course_id: z.string().uuid().nullable(),
    student_id: z.string().uuid().nullable(),
    hourly_pay: money,
    currency: z.enum(currencies),
    student_price: money.nullable(),
    effective_from: date,
    active: z.boolean().default(true),
  })
  .strict();
const inputSchema = z
  .object({
    teacher_id: z.string().uuid(),
    hourly_pay: money,
    currency: z.enum(currencies),
    cycle: z.enum(["weekly", "monthly"]),
    rules: z.array(ruleSchema).max(100),
    revision: z.number().int().nonnegative(),
  })
  .strict();
async function config() {
  return (await store.read(KEY, { teachers: {} })).value;
}
async function list() {
  const cfg=await config();return {...cfg,teachers:await require('./dataScope.js').filterSalaryRecords(cfg.teachers),currencies};
}
async function allLessons(teacherId, window = {}, includeAbsence=false) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    let q = getAdmin()
      .from("lessons")
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    q=includeAbsence?q.in("status",["completed","no_show"]):q.eq("status","completed");
    if (teacherId) q = q.eq("teacher_id", teacherId);
    if (window.fromIso) q = q.gte("scheduled_at", window.fromIso);
    if (window.toIso) q = q.lte("scheduled_at", window.toIso);
    const result = await q;
    if (result.error) throw new HttpError(503, "PAYROLL_UNAVAILABLE", "课程明细读取失败");
    rows.push(...(result.data || []));
    if ((result.data || []).length < 500) return rows;
  }
  throw new HttpError(400, "PAYROLL_TOO_LARGE", "统计范围过大，请缩短日期范围");
}
const dayOf = (iso) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
function resolve(lesson, teacher, cfg) {
  const day = dayOf(lesson.scheduled_at);
  const eligible = (cfg?.rules || []).filter(
    (r) =>
      r.active &&
      r.effective_from <= day &&
      (!r.course_id || r.course_id === lesson.course_id) &&
      (!r.student_id || r.student_id === lesson.student_id),
  );
  eligible.sort(
    (a, b) =>
      (b.student_id ? 2 : 0) +
        (b.course_id ? 1 : 0) -
        ((a.student_id ? 2 : 0) + (a.course_id ? 1 : 0)) ||
      b.effective_from.localeCompare(a.effective_from),
  );
  const rule = eligible[0];
  // 默认单价同样按生效历史匹配，不能用后来改过的默认值重算旧课。
  const version = (cfg?.defaults || [])
    .filter((v) => v.effective_from <= day)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    hourly_pay: rule?.hourly_pay ?? version?.hourly_pay ?? Number(teacher.hourly_pay || 0),
    currency: rule?.currency ?? version?.currency ?? teacher.pay_currency ?? "PHP",
    student_price: rule?.student_price ?? null,
    rule_id: rule?.id || null,
  };
}
const snapshotKey = (id) => `private/payroll-lessons/${id}`;
async function snapshot(lesson, teacher) {
  const cfg = await config();
  const price = resolve(lesson, teacher, cfg.teachers[lesson.teacher_id]);
  let frozen;
  await store.change(snapshotKey(lesson.id), null, (old) => {
    const matches =
      old &&
      old.teacher_id === lesson.teacher_id &&
      old.student_id === lesson.student_id &&
      old.course_id === lesson.course_id &&
      old.scheduled_at === lesson.scheduled_at &&
      Number(old.duration_min) === Number(lesson.duration_min);
    // 仅用于尚未完课的消课流程：之前失败后改期的课节应重新计价。
    frozen = matches
      ? old
      : {
          ...price,
          teacher_id: lesson.teacher_id,
          student_id: lesson.student_id,
          course_id: lesson.course_id,
          scheduled_at: lesson.scheduled_at,
          duration_min: lesson.duration_min,
          amount: Math.round(((price.hourly_pay * Number(lesson.duration_min)) / 60) * 100) / 100,
          student_amount:
            price.student_price == null
              ? null
              : Math.round(((price.student_price * Number(lesson.duration_min)) / 60) * 100) / 100,
          at: new Date().toISOString(),
        };
    return matches ? null : frozen;
  });
  // 失败后重试或改课时必须重新核对，避免复用旧课节价格。
  if (
    frozen.teacher_id !== lesson.teacher_id ||
    frozen.student_id !== lesson.student_id ||
    frozen.course_id !== lesson.course_id ||
    frozen.scheduled_at !== lesson.scheduled_at ||
    Number(frozen.duration_min) !== Number(lesson.duration_min)
  )
    throw new HttpError(409, "PRICE_SNAPSHOT_CHANGED", "课节信息已变化，请联系管理员核对课酬快照");
  return frozen;
}
async function freezeLegacy(teacher) {
  const lessons = await allLessons(teacher.profile_id);
  for (const lesson of lessons) {
    await store.change(snapshotKey(lesson.id), null, (old) =>
      old
        ? null
        : {
            teacher_id: lesson.teacher_id,
            student_id: lesson.student_id,
            course_id: lesson.course_id,
            scheduled_at: lesson.scheduled_at,
            duration_min: lesson.duration_min,
            hourly_pay: Number(lesson.pay_rate ?? teacher.hourly_pay ?? 0),
            amount: Number(
              lesson.pay_amount ??
                Math.round(
                  ((Number(lesson.pay_rate ?? teacher.hourly_pay ?? 0) * lesson.duration_min) /
                    60) *
                    100,
                ) / 100,
            ),
            currency: teacher.pay_currency || "PHP",
            student_price: null,
            student_amount: null,
            legacy: true,
          },
    );
  }
}
async function save(req, body) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(400, "PRICING_INVALID", "请检查币种、单价、生效日期及规则");
  const input = parsed.data;
  const teacherResult = await getAdmin()
    .from("teachers")
    .select("*")
    .eq("profile_id", input.teacher_id)
    .maybeSingle();
  if (teacherResult.error) throw new HttpError(503, "PAYROLL_UNAVAILABLE", "教师资料读取失败");
  if (!teacherResult.data) throw new HttpError(404, "TEACHER_NOT_FOUND", "教师不存在");
  const today = dayOf(new Date().toISOString());
  const existing = (await config()).teachers[input.teacher_id];
  if ((existing?.revision || 0) !== input.revision)
    throw new HttpError(409, "PRICING_CHANGED", "设置已被修改，请刷新后重试");
  for (const r of input.rules) {
    const old = existing?.rules?.find((v) => v.id === r.id);
    if (
      (!old ||
        JSON.stringify(
          [
            "course_id",
            "student_id",
            "hourly_pay",
            "currency",
            "student_price",
            "effective_from",
            "active",
          ].map((k) => old[k]),
        ) !==
          JSON.stringify(
            [
              "course_id",
              "student_id",
              "hourly_pay",
              "currency",
              "student_price",
              "effective_from",
              "active",
            ].map((k) => r[k]),
          )) &&
      r.effective_from < today
    )
      throw new HttpError(
        400,
        "PRICING_PAST",
        "新增或修改规则的生效日期不能早于今天；历史快照保持不变",
      );
    if (r.course_id) {
      const result = await getAdmin()
        .from("courses")
        .select("id,teacher_id,student_id")
        .eq("id", r.course_id)
        .maybeSingle();
      if (result.error) throw new HttpError(503, "PRICING_UNAVAILABLE", "课程读取失败");
      if (
        !result.data ||
        result.data.teacher_id !== input.teacher_id ||
        (r.student_id && result.data.student_id && result.data.student_id !== r.student_id)
      )
        throw new HttpError(400, "PRICING_SCOPE", "课程或学生与该老师不匹配");
    }
    if (r.student_id) {
      const result = await getAdmin()
        .from("students")
        .select("id")
        .eq("id", r.student_id)
        .maybeSingle();
      if (result.error) throw new HttpError(503, "PRICING_UNAVAILABLE", "学生读取失败");
      if (!result.data) throw new HttpError(400, "PRICING_SCOPE", "学生不存在");
    }
  }
  const ids = input.rules.map((r) => r.id).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, "PRICING_DUPLICATE", "规则编号重复，请重新载入设置");
  const scopes = input.rules
    .filter((r) => r.active)
    .map((r) => [r.course_id, r.student_id, r.effective_from].join("|"));
  if (new Set(scopes).size !== scopes.length)
    throw new HttpError(400, "PRICING_DUPLICATE", "同一学生、课程、生效日只能设置一条有效规则");
  // 在修改任何默认价之前锁定旧课节，旧金额、旧币种不会被新设置覆盖。
  await freezeLegacy(teacherResult.data);
  const at = new Date().toISOString();
  const result = await store.change(KEY, { teachers: {} }, (data) => {
    const old = data.teachers[input.teacher_id];
    if ((old?.revision || 0) !== input.revision)
      throw new HttpError(409, "PRICING_CHANGED", "设置已变化，请刷新");
    const defaults = old?.defaults || [];
    return {
      teachers: {
        ...data.teachers,
        [input.teacher_id]: {
          ...input,
          rules: input.rules.map((r) => ({ ...r, id: r.id || store.randomId() })),
          revision: input.revision + 1,
          defaults: [
            ...defaults,
            { hourly_pay: input.hourly_pay, currency: input.currency, effective_from: today, at },
          ],
          at,
        },
      },
    };
  });
  await require("./audit.js").record(
    req.context.userId,
    "payroll.pricing",
    "teacher",
    input.teacher_id,
    { revision: input.revision + 1 },
    req.reqId,
  );
  return result.teachers[input.teacher_id];
}
module.exports = {
  list,
  config,
  save,
  snapshot,
  snapshotKey,
  freezeLegacy,
  allLessons,
  resolve,
  dayOf,
  currencies,
};
