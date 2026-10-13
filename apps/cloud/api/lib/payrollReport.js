const pricing = require("./payrollPricing.js");
const store = require("./secureStore.js");
const { getAdmin } = require("./supabase.js");
const { HttpError } = require("./errors.js");
const { parseWindow } = require("./window.js");
const round = (v) => Math.round(v * 100) / 100;
function periodFor(day, kind) {
  if (kind === "weekly") {
    const date = new Date(day + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { from, to: date.toISOString().slice(0, 10) };
  }
  const from = day.slice(0, 7) + "-01";
  const d = new Date(from + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}
async function referenceRows(table, fields, filter) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    let q = getAdmin()
      .from(table)
      .select(fields)
      .order(table === "teachers" ? "profile_id" : "id")
      .range(offset, offset + 499);
    if (filter) q = q.eq(filter[0], filter[1]);
    const result = await q;
    if (result.error) throw new HttpError(503, "PAYROLL_UNAVAILABLE", "统计资料读取失败");
    rows.push(...(result.data || []));
    if ((result.data || []).length < 500) return { data: rows };
  }
  throw new HttpError(400, "PAYROLL_TOO_LARGE", "统计资料过多，请联系管理员");
}
async function report(req, params) {
  const kind = params.get("period") || "monthly";
  if (!["weekly", "monthly"].includes(kind))
    throw new HttpError(400, "PAYROLL_PERIOD", "周期应为 weekly 或 monthly");
  for (const field of ["from", "to"]) {
    const value = params.get(field);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new HttpError(400, "PAYROLL_WINDOW", "日期格式或日期无效");
  }
  const window = parseWindow(params.get("from"), params.get("to"));
  if (window.bad) throw new HttpError(400, "PAYROLL_WINDOW", window.bad);
  const teacherId = req.context.role === "teacher" ? req.context.userId : params.get("teacher_id");
  if (teacherId && !/^[0-9a-f-]{36}$/i.test(teacherId))
    throw new HttpError(400, "PAYROLL_TEACHER", "教师编号无效");
  const [lessons, teachersResult, profilesResult, coursesResult, studentsResult, cfg] =
    await Promise.all([
      pricing.allLessons(teacherId, window, true),
      referenceRows("teachers", "profile_id,hourly_pay,pay_currency"),
      referenceRows("profiles", "id,full_name", ["role", "teacher"]),
      referenceRows("courses", "id,name"),
      referenceRows("students", "id,full_name"),
      store.ready() ? pricing.config() : { teachers: {} },
    ]);
  for (const r of [teachersResult, profilesResult, coursesResult, studentsResult])
    if (r.error) throw new HttpError(503, "PAYROLL_UNAVAILABLE", "统计资料读取失败");
  const teachers = new Map((teachersResult.data || []).map((t) => [t.profile_id, t]));
  const names = new Map((profilesResult.data || []).map((t) => [t.id, t.full_name]));
  const courses = new Map((coursesResult.data || []).map((t) => [t.id, t.name]));
  const students = new Map((studentsResult.data || []).map((t) => [t.id, t.full_name]));
  const pendingAbsences = lessons.filter((l) => l.absence_review_status === "pending");
  const details = [];
  // 分批读取，不一次启动数千个加密对象请求。
  for (let i = 0; i < lessons.length; i += 10) {
    const batch = await Promise.all(
      lessons
        .slice(i, i + 10)
        .filter(
          (l) =>
            !l.history_settled && (l.status !== "no_show" ||
            (l.absence_review_status !== "pending" &&
              (Number(l.pay_amount) > 0 || l.absence_review_status === "confirmed"))),
        )
        .map(async (l) => {
          const teacher = teachers.get(l.teacher_id) || {};
          const correction = await require("./lessonCorrections.js").get(l.id);
          if (correction?.state === "pending" && correction.input?.mode === "attendance")
            throw new HttpError(
              409,
              "CORRECTION_PENDING",
              "存在尚未完成的考勤更正，请先完成更正后再核对课酬",
            );
          const frozen = store.ready()
            ? (await store.read(pricing.snapshotKey(l.id), null)).value
            : null;
          const amount = Number(
            l.pay_amount ??
              (l.pay_rate == null
                ? frozen?.amount
                : round((Number(l.pay_rate) * l.duration_min) / 60)) ??
              round((Number(teacher.hourly_pay || 0) * l.duration_min) / 60),
          );
          const rate = Number(
            l.status === "no_show" && l.absence_pay_teacher === false
              ? (frozen?.base_hourly_pay ?? frozen?.hourly_pay ?? teacher.hourly_pay ?? 0)
              : (l.pay_rate ?? frozen?.hourly_pay ?? teacher.hourly_pay ?? 0),
          );
          const day = pricing.dayOf(l.scheduled_at);
          const period = periodFor(day, kind);
          return {
            lesson_id: l.id,
            attendance_status: l.status || "completed",
            teacher_id: l.teacher_id,
            teacher_name: names.get(l.teacher_id) || "",
            student_name: students.get(l.student_id) || "",
            course_name: courses.get(l.course_id) || "临时课程",
            scheduled_at: l.scheduled_at,
            day,
            duration_min: Number(l.duration_min),
            payable_minutes:
              l.status === "no_show" && Number(l.pay_amount) === 0 ? 0 : Number(l.duration_min),
            hourly_pay: rate,
            pay_amount: amount,
            pay_currency: frozen?.currency || teacher.pay_currency || "PHP",
            student_price: req.context.role === "teacher" ? null : (frozen?.student_price ?? null),
            student_amount:
              req.context.role === "teacher" ? null : (frozen?.student_amount ?? null),
            legacy: !frozen || !!frozen.legacy,
            period_from: period.from,
            period_to: period.to,
            cycle: cfg.teachers[l.teacher_id]?.cycle || "monthly",
          };
        }),
    );
    details.push(...batch);
  }
  const groups = new Map();
  for (const d of details) {
    const key = [d.teacher_id, d.period_from, d.pay_currency].join("|");
    if (!groups.has(key))
      groups.set(key, {
        teacher_id: d.teacher_id,
        teacher_name: d.teacher_name,
        period_from: d.period_from,
        period_to: d.period_to,
        period: kind,
        month: d.period_from.slice(0, 7) + "-01",
        pay_currency: d.pay_currency,
        cycle: d.cycle,
        lessons_done: 0,
        minutes_done: 0,
        pay_amount: 0,
        lesson_ids: [],
      });
    const row = groups.get(key);
    if (d.attendance_status !== "no_show" || d.pay_amount > 0) row.lessons_done++;
    row.minutes_done += d.payable_minutes;
    row.pay_amount += d.pay_amount;
    row.lesson_ids.push(d.lesson_id);
  }
  const rows = [...groups.values()]
    .map((r) => ({ ...r, pay_amount: round(r.pay_amount) }))
    .sort(
      (a, b) =>
        b.period_from.localeCompare(a.period_from) || a.teacher_name.localeCompare(b.teacher_name),
    );
  const by_currency = {};
  for (const r of rows)
    by_currency[r.pay_currency] = round((by_currency[r.pay_currency] || 0) + r.pay_amount);
  return {
    range: { from: window.from, to: window.to },
    period: kind,
    rows,
    details: details.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
    totals: {
      teachers: new Set(rows.map((r) => r.teacher_id)).size,
      lessons_done: details.filter((d) => d.attendance_status !== "no_show" || d.pay_amount > 0)
        .length,
      hours: round(details.reduce((n, d) => n + d.payable_minutes, 0) / 60),
      by_currency,
    },
    pending_absences: pendingAbsences.length,
    storageReady: store.ready(),
  };
}
module.exports = { report, periodFor };
