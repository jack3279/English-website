const { ok, badRequest, notFound } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch } = require("../lib/rest.js");

// 时间窗口口径收口在 lib/window.js（财务 / 课堂报告 / 运营待办共用一套，
// 各写一份必然长歪——尤其 +08:00 的月份边界）。
const {
  monthStartIso,
  parseWindow,
  applyWindow,
  normalizeMonthParam,
  floorToMonthStart,
} = require("../lib/window.js");

// 单节课的课酬。口径必须与 teacher_payroll 视图一致，否则页面上的月度合计
// 会和明细对不上：课节快照 pay_amount > 快照 pay_rate > 老师当前 hourly_pay，再乘时长占比。
// 注意用 `!= null` 而不是真值判断 —— 快照为 0 是"明确不结算"，不能掉进回退分支。
function payOfLesson(l, hourlyPay) {
  const snap = l?.pay_amount;
  if (snap !== null && snap !== undefined) return Math.round(Number(snap) * 100) / 100;
  const rate =
    l?.pay_rate !== null && l?.pay_rate !== undefined ? Number(l.pay_rate) : Number(hourlyPay || 0);
  const hours = Number(l?.duration_min || 0) / 60;
  return Math.round(rate * hours * 100) / 100;
}

// 老师看自己的课酬；管理员进来自动切到"所有老师汇总"视图。
// ⚠️ 收件人固定取登录身份，**永远不接受 teacher_id 参数** —— 否则换个人 uuid 就能看同事工资。
async function myPayroll(req, res, url) {
  // 与前端 RoleGuard 保持一致: 只有老师与管理员能进。家长即使进来也只会看到
  // 空数据(没有教师档案), 但接口不该比 UI 松 —— 权限边界两边要对齐。
  requireRole(req, res, "admin", "teacher");

  const admin = getAdmin();
  const me = req.context.userId;
  const role = req.context.role;

  const win = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
  if (win.bad) {
    badRequest(res, win.bad);
    return;
  }

  // ====== 管理员: 看所有老师汇总 ======
  if (role === "admin") {
    // 直接复用视图, 与 /finance/payroll 同源, 保证两处数字一致
    let q = admin
      .from("teacher_payroll")
      .select("teacher_id, teacher_name, month, lessons_done, minutes_done, pay_amount")
      .order("month", { ascending: false })
      .limit(500);
    // 月桶过滤：from 归月首，避免月中起点漏掉起始整月。
    if (win.from) q = q.gte("month", floorToMonthStart(win.from));
    if (win.to) q = q.lte("month", win.to);
    const { data: rows, error } = await q;
    if (error) throw error;

    const list = rows ?? [];
    // 按老师聚合 (汇总每位老师, 跨月合并)
    const byTeacher = new Map();
    for (const r of list) {
      const cur = byTeacher.get(r.teacher_id) || {
        teacher_id: r.teacher_id,
        teacher_name: r.teacher_name,
        lessons_done: 0,
        minutes_done: 0,
        pay_amount: 0,
        month_count: 0,
      };
      cur.lessons_done += Number(r.lessons_done || 0);
      cur.minutes_done += Number(r.minutes_done || 0);
      cur.pay_amount += Number(r.pay_amount || 0);
      cur.month_count += 1;
      byTeacher.set(r.teacher_id, cur);
    }
    const teachers = [...byTeacher.values()]
      .map((t) => ({
        teacher_id: t.teacher_id,
        teacher_name: t.teacher_name,
        lessons_done: t.lessons_done,
        hours: Math.round((t.minutes_done / 60) * 100) / 100,
        pay_amount: Math.round(t.pay_amount * 100) / 100,
        month_count: t.month_count,
      }))
      .sort((a, b) => b.pay_amount - a.pay_amount);

    // 老师课酬单价 (前端可显示/编辑)
    const { data: teacherRows } = await admin
      .from("teachers")
      .select("profile_id, hourly_pay, pay_currency, active");
    const rateIds = [...new Set((teacherRows ?? []).map((t) => t.profile_id).filter(Boolean))];
    const { data: rateProfs } = rateIds.length
      ? await admin.from("profiles").select("id, full_name").in("id", rateIds)
      : { data: [] };
    const rateNameMap = Object.fromEntries((rateProfs ?? []).map((p) => [p.id, p.full_name]));
    const rates = (teacherRows ?? []).map((t) => ({
      teacher_id: t.profile_id,
      teacher_name: rateNameMap[t.profile_id] ?? "",
      hourly_pay: Number(t.hourly_pay ?? 0),
      pay_currency: t.pay_currency ?? "PHP",
      active: t.active ?? true,
    }));

    const totals = {
      teachers: teachers.length,
      lessons_done: teachers.reduce((s, t) => s + t.lessons_done, 0),
      hours: Math.round(teachers.reduce((s, t) => s + t.hours, 0) * 100) / 100,
      pay_amount: Math.round(teachers.reduce((s, t) => s + t.pay_amount, 0) * 100) / 100,
    };
    const currencyMap = new Map(rates.map((r) => [r.teacher_id, r.pay_currency]));
    const byCurrency = {};
    for (const teacher of teachers) {
      teacher.pay_currency = currencyMap.get(teacher.teacher_id) || null;
      const code = teacher.pay_currency || "UNSPECIFIED";
      byCurrency[code] = (byCurrency[code] || 0) + teacher.pay_amount;
    }
    totals.by_currency = Object.fromEntries(
      Object.entries(byCurrency).map(([code, amount]) => [code, Math.round(amount * 100) / 100]),
    );
    if (Object.keys(byCurrency).length > 1) totals.pay_amount = null;

    ok(res, {
      scope: "all",
      role: "admin",
      range: { from: win.from, to: win.to },
      teachers,
      totals,
      rates,
    });
    return;
  }

  // ====== 老师: 看自己 (原逻辑, 维持不变) ======
  const { data: teacher } = await admin
    .from("teachers")
    .select("profile_id, hourly_pay, pay_currency, active")
    .eq("profile_id", me)
    .maybeSingle();

  const hourlyPay = Number(teacher?.hourly_pay ?? 0);
  const currency = teacher?.pay_currency || "PHP";

  // 按月汇总：直接复用视图，保证与管理员看到的数字同源。
  let mq = admin
    .from("teacher_payroll")
    .select("month, lessons_done, minutes_done, pay_amount")
    .eq("teacher_id", me)
    .order("month", { ascending: false })
    .limit(60);
  // 月桶过滤：from 归月首（课节明细 lq 仍按 win.fromIso 精确到日）。
  if (win.from) mq = mq.gte("month", floorToMonthStart(win.from));
  if (win.to) mq = mq.lte("month", win.to);
  const { data: monthRows, error } = await mq;
  if (error) throw error;

  // 明细：老师最想看的是"哪节课算了多少"，光有月合计没法核对。
  let lq = admin
    .from("lessons")
    .select("id, status, scheduled_at, duration_min, pay_amount, pay_rate, students:student_id (full_name)")
    .eq("teacher_id", me)
    .in("status", ["completed","no_show"])
    .order("scheduled_at", { ascending: false })
    .limit(50);
  if (win.fromIso) lq = lq.gte("scheduled_at", win.fromIso);
  if (win.toIso) lq = lq.lte("scheduled_at", win.toIso);
  const { data: lessonRows, error: lErr } = await lq;
  if (lErr) throw lErr;

  const months = (monthRows ?? []).map((r) => ({
    month: r.month,
    lessons_done: Number(r.lessons_done || 0),
    minutes_done: Number(r.minutes_done || 0),
    hours: Math.round((Number(r.minutes_done || 0) / 60) * 100) / 100,
    pay_amount: Math.round(Number(r.pay_amount || 0) * 100) / 100,
  }));

  const totals = {
    lessons_done: months.reduce((s, r) => s + r.lessons_done, 0),
    hours: Math.round(months.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    pay_amount: Math.round(months.reduce((s, r) => s + r.pay_amount, 0) * 100) / 100,
  };

  const recent = (lessonRows ?? []).filter(l=>l.status!=="no_show"||Number(l.pay_amount)>0).map((l) => ({
    id: l.id,
    scheduled_at: l.scheduled_at,
    student_name: l.students?.full_name ?? null,
    attendance_status:l.status||"completed",
    duration_min: Number(l.duration_min || 0),
    amount: payOfLesson(l, hourlyPay),
    // 快照为 null 说明这节按"老师当前单价"折算 —— 页面上标注出来, 免得对不上账时找不到原因
    from_snapshot: l.pay_amount !== null && l.pay_amount !== undefined,
  }));

  ok(res, {
    scope: "self",
    role: "teacher",
    teacher: { hourly_pay: hourlyPay, pay_currency: currency, bound: !!teacher },
    range: { from: win.from, to: win.to },
    months,
    totals,
    recent,
  });
}

module.exports = async function handler(req, res) {
  await requireAuth(req, res);

  const url = new URL(req.url, "http://x");

  if (url.pathname === "/payroll/settlements" && req.method === "GET") {
    requireRole(req, res, "admin", "teacher");
    ok(res, await require("../lib/payrollSettlements.js").list(req));
    return;
  }
  if (url.pathname === "/payroll/settlements" && req.method === "POST") {
    requireRole(req, res, "admin");
    ok(res, await require("../lib/payrollSettlements.js").save(req, req.body));
    return;
  }

  if (url.pathname === "/payroll/period-settlements" && req.method === "POST") {
    requireRole(req, res, "admin");
    ok(res, await require("../lib/payrollPeriodSettlement.js").save(req, req.body));
    return;
  }
  if (url.pathname === "/payroll/report" && req.method === "GET") {
    requireRole(req, res, "admin", "teacher");
    ok(res, await require("../lib/payrollReport.js").report(req, url.searchParams));
    return;
  }
  if (url.pathname === "/payroll/pricing") {
    requireRole(req, res, "admin");
    if (req.method === "GET") ok(res, await require("../lib/payrollPricing.js").list());
    else if (req.method === "POST")
      ok(res, await require("../lib/payrollPricing.js").save(req, req.body));
    else badRequest(res, "不支持的请求");
    return;
  }

  // GET /finance/my-payroll —— 老师看**自己的**课酬。
  // 必须放在下面那道 requireRole(admin) 之前：财务页整块是管理员专属，
  // 但"我这个月挣多少"是老师自己的事，每次都去问教务，教务就成了人肉查询接口。
  // ⚠️ 收件人一律取登录身份(req.context.userId)，**不接受客户端传 teacher_id** ——
  // 否则改成别人的 uuid 就能看同事的工资。
  if (req.method === "GET" && url.pathname === "/my-payroll") {
    return myPayroll(req, res, url);
  }

  requireRole(req, res, "admin");

  const admin = getAdmin();

  // GET /finance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
  // 不带参数 = 本月（页面默认档）。给了区间就按区间统计, 「上月」自动变成
  // 「紧邻的等长上一窗口」, 这样「近 30 天」比的是前一个 30 天, 而不是上一个自然月。
  if (req.method === "GET" && url.pathname === "/summary") {
    const win = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
    if (win.bad) {
      badRequest(res, win.bad);
      return;
    }
    const monthStart = win.fromIso || monthStartIso(0);
    const nowIso = win.toIso || new Date().toISOString();
    const prevMonthStart = win.fromIso
      ? new Date(
          new Date(monthStart).getTime() - (new Date(nowIso) - new Date(monthStart)),
        ).toISOString()
      : monthStartIso(-1);

    // 当期 payments (按 paid_at 落在窗口内)
    const { data: monthPays, error: monthPaysError } = await applyWindow(
      admin.from("package_payments").select("amount_cents, paid_at"),
      "paid_at",
      monthStart,
      nowIso,
    );
    if (monthPaysError) throw monthPaysError;
    const monthRevenue = (monthPays ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);
    const received = (monthPays ?? [])
      .filter((p) => Number(p.amount_cents) > 0)
      .reduce((n, p) => n + Number(p.amount_cents), 0);
    const refunded = -(monthPays ?? [])
      .filter((p) => Number(p.amount_cents) < 0)
      .reduce((n, p) => n + Number(p.amount_cents), 0);

    // 上一窗口 payments
    const { data: prevPays, error: previousError } = await admin
      .from("package_payments")
      .select("amount_cents, paid_at")
      .gte("paid_at", prevMonthStart)
      .lt("paid_at", monthStart);
    if (previousError) throw previousError;
    const prevRevenue = (prevPays ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);

    // 当期消耗课时 (lesson_transactions delta < 0 + reason=consume)
    const { data: monthTxs, error: transactionsError } = await applyWindow(
      admin.from("lesson_transactions").select("delta, reason"),
      "created_at",
      monthStart,
      nowIso,
    );
    if (transactionsError) throw transactionsError;
    const consumed = (monthTxs ?? [])
      .filter((t) => t.reason === "consume")
      .reduce((s, t) => s + Number(t.delta), 0); // delta 负数

    // 学员总数 + 低余额
    const { count: studentCount, error: activeStudentsError } = await admin
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (activeStudentsError) throw activeStudentsError;
    const { lowBalanceHours } = await require("../lib/institutionSettings.js").getSettings();
    const { data: lowBals, error: balancesError } = await admin
      .from("student_balance")
      .select("remaining_hours")
      .lt("remaining_hours", lowBalanceHours);
    if (balancesError) throw balancesError;

    // 总在读
    const { count: totalStudents, error: studentsError } = await admin
      .from("students")
      .select("id", { count: "exact", head: true });

    // 当期完课数
    if (studentsError) throw studentsError;
    const { count: completedLessons, error: completedError } = await applyWindow(
      admin.from("lessons").select("id", { count: "exact", head: true }).eq("status", "completed"),
      "completed_at",
      monthStart,
      nowIso,
    );

    if (completedError) throw completedError;
    ok(res, {
      // 前端靠 period 判断当前是「本月」还是自定义区间, 用来改标题文案
      period: { from: win.from, to: win.to, preset: win.from ? "custom" : "this_month" },
      this_month: {
        revenue_cents: monthRevenue,
        received_cents: received,
        refunded_cents: refunded,
        consumed_hours: Math.abs(consumed),
        completed_lessons: completedLessons ?? 0,
      },
      last_month: {
        revenue_cents: prevRevenue,
      },
      total: {
        active_students: studentCount ?? 0,
        all_students: totalStudents ?? 0,
        low_balance_count: (lowBals ?? []).length,
      },
    });
    return;
  }

  // GET /finance/exceptions
  if (req.method === "GET" && url.pathname === "/exceptions") {
    // 三类异常:
    // 1. 负余额: remaining_hours < 0
    // 2. 过期未用: student_packages.expires_at < now() AND remaining_hours > 0
    // 3. 即将过期 (7 天内): expires_at in (now, now+7d) AND remaining_hours > 0
    const nowIso = new Date().toISOString();
    const sevenDays = new Date(Date.now() + 7 * 86400_000).toISOString();

    // 负余额 + 即将过期/已过期 (用 student_packages + student_balance view)
    const { data: pkgs } = await admin
      .from("student_packages")
      .select(
        "id, student_id, total_hours, remaining_hours, expires_at, notes, package_types(name), students(full_name, branch_id)",
      )
      .gt("remaining_hours", 0)
      .not("expires_at", "is", null)
      .lte("expires_at", sevenDays)
      .order("expires_at")
      .limit(50);

    const { data: negBal } = await admin
      .from("student_balance")
      .select("student_id, remaining_hours, students(full_name)")
      .lt("remaining_hours", 0)
      .limit(50);

    ok(res, {
      expiring_soon: (pkgs ?? []).map((p) => ({
        package_id: p.id,
        student_id: p.student_id,
        student_name: p.students?.full_name ?? "?",
        package_name: p.package_types?.name ?? "?",
        remaining_hours: Number(p.remaining_hours),
        expires_at: p.expires_at,
        kind: new Date(p.expires_at) < new Date() ? "expired" : "expiring_7d",
      })),
      negative_balance: (negBal ?? []).map((b) => ({
        student_id: b.student_id,
        student_name: b.students?.full_name ?? "?",
        remaining_hours: Number(b.remaining_hours),
      })),
    });
    return;
  }

  // GET /finance/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD  — 营收明细（页面列表 + CSV 导出）
  if (req.method === "GET" && url.pathname === "/revenue") {
    const win = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
    if (win.bad) {
      badRequest(res, win.bad);
      return;
    }
    // 一次最多 500 条: 免费档出网 5GB/月, 别让一个导出把额度吃掉。
    // 真要全量历史请走 /admin/import 的导出或让教务按季度看。
    const { data, error } = await applyWindow(
      admin
        .from("package_payments")
        .select(
          "id, amount_cents, method, paid_at, notes, student_id, students(full_name), student_packages(package_types(name))",
        )
        .order("paid_at", { ascending: false })
        .limit(500),
      "paid_at",
      win.fromIso,
      win.toIso,
    );
    if (error) throw error;

    const rows = (data ?? []).map((p) => ({
      id: p.id,
      paid_at: p.paid_at,
      amount_cents: Number(p.amount_cents),
      method: p.method,
      notes: p.notes,
      student_id: p.student_id,
      student_name: p.students?.full_name ?? "?",
      package_name: p.student_packages?.package_types?.name ?? "—",
    }));
    ok(res, {
      period: { from: win.from, to: win.to },
      total_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
      count: rows.length,
      // truncated=true 时前端要提示「仅显示最近 500 条」, 否则用户会以为这就是全部
      truncated: rows.length >= 500,
      rows,
    });
    return;
  }

  // GET /finance/renewals  — 续费清单：谁该续费了
  // 判定口径与定时提醒 renewalReminders 共用 pickRenewalAlerts, 避免
  // 「页面说要续费、机器人却没提醒」这种两套标准的情况。
  if (req.method === "GET" && url.pathname === "/renewals") {
    const { pickRenewalAlerts } = require("../src/scheduled.js");
    const packs=await require('../lib/renewalBalances.js').loadRenewalPackages(admin);

    const actualPacks=await require('../lib/renewalBalances.js').withStudentBalances(admin,packs);
    const alerts = pickRenewalAlerts(actualPacks,Date.now(),await require('../lib/institutionSettings.js').getSettings());
    const studentIds = [...new Set(alerts.map((a) => a.pack?.student_id).filter(Boolean))];
    const { data: stuRows } = studentIds.length
      ? await admin.from("students").select("id, full_name, status").in("id", studentIds)
      : { data: [] };

    // 仅在读学员进续费清单（停课/休学/结课/退费不打无效外呼）
    const byId = new Map(
      (stuRows ?? []).filter((s) => s.status === "active").map((s) => [s.id, s]),
    );
    const keepIds = [...byId.keys()];

    // 学员表本身没有电话, 联系电话挂在家长账号上:
    // student -> parent_student_links -> parents.profile_id -> profiles.phone
    const phoneByStudent = new Map();
    if (keepIds.length) {
      const { data: links } = await admin
        .from("parent_student_links")
        .select("student_id, parents(profile_id, profiles(phone))")
        .in("student_id", keepIds);
      for (const l of links ?? []) {
        const phone = l.parents?.profiles?.phone;
        if (phone && !phoneByStudent.has(l.student_id)) phoneByStudent.set(l.student_id, phone);
      }
    }

    // 同一学员可能有多个包命中, 合并成一行, 取最紧急的那个阶段
    const merged = new Map();
    for (const a of alerts) {
      const stu = byId.get(a.pack?.student_id);
      if (!stu) continue;
      const prev = merged.get(stu.id);
      const stage = a.stage === "expiring" ? "expiring" : "low";
      if (prev && prev.stage === "expiring") continue; // 已是最紧急
      merged.set(stu.id, {
        student_id: stu.id,
        student_name: stu.full_name ?? "?",
        phone: phoneByStudent.get(stu.id) ?? "",
        package_name: a.pack?.package_types?.name ?? "课时包",
        remaining_hours: Number(a.balance ?? 0),
        total_hours: Number(a.total ?? 0),
        expires_at: a.pack?.expires_at ?? null,
        stage,
      });
    }

    const list = [...merged.values()].sort((x, y) => x.remaining_hours - y.remaining_hours);
    ok(res, { count: list.length, rows: list });
    return;
  }

  // GET /finance/payroll?from=YYYY-MM-DD&to=YYYY-MM-DD   (老师课酬结算)
  if (req.method === "GET" && url.pathname === "/payroll") {
    // month 是 date 类型(每月 1 号)。看板传的是 YYYY-MM, 直接拿去比较会因
    // 无法转成 date 而在库里报错(500)；先归一化成 YYYY-MM-DD。
    const nf = normalizeMonthParam(url.searchParams.get("from"));
    const nt = normalizeMonthParam(url.searchParams.get("to"));
    if (nf.bad || nt.bad) {
      badRequest(res, nf.bad || nt.bad);
      return;
    }
    if (require('../lib/secureStore.js').ready())
      return ok(res,await require('../lib/legacyPayrollReport.js').build(req,nf.value,nt.value));
    let q = admin
      .from("teacher_payroll")
      .select("teacher_id, teacher_name, month, lessons_done, minutes_done, pay_amount")
      .order("month", { ascending: false })
      .limit(500);
    // month 是月桶（每月 1 号）：from 归到所在月首，避免月中起点漏掉整个起始月。
    if (nf.value) q = q.gte("month", floorToMonthStart(nf.value));
    if (nt.value) q = q.lte("month", nt.value);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    const totals = {
      teachers: new Set(rows.map((r) => r.teacher_id)).size,
      lessons_done: rows.reduce((s, r) => s + Number(r.lessons_done || 0), 0),
      hours:
        Math.round((rows.reduce((s, r) => s + Number(r.minutes_done || 0), 0) / 60) * 100) / 100,
      pay_amount: Math.round(rows.reduce((s, r) => s + Number(r.pay_amount || 0), 0) * 100) / 100,
    };
    // 老师课酬单价 (便于前端就地改价)
    // 注意: 不再返回历史字段 default_rate(单位存疑), 也不 select profiles.email(该列不存在)
    const { data: teacherRows, error: rateError } = await admin
      .from("teachers")
      .select("profile_id, hourly_pay, pay_currency");
    if (rateError) throw rateError;
    const currencies = new Map(
      (teacherRows ?? []).map((t) => [t.profile_id, t.pay_currency || "PHP"]),
    );
    const currencyTotals = {};
    for (const row of rows) {
      row.pay_currency = currencies.get(row.teacher_id) || null;
      const code = row.pay_currency || "UNSPECIFIED";
      currencyTotals[code] = (currencyTotals[code] || 0) + Number(row.pay_amount || 0);
    }
    totals.by_currency = Object.fromEntries(
      Object.entries(currencyTotals).map(([code, amount]) => [
        code,
        Math.round(amount * 100) / 100,
      ]),
    );
    // Amounts in different currencies have no meaningful combined total.
    if (Object.keys(currencyTotals).length > 1) totals.pay_amount = null;
    const rateIds = [...new Set((teacherRows ?? []).map((t) => t.profile_id).filter(Boolean))];
    const { data: rateProfs, error: profileError } = rateIds.length
      ? await admin.from("profiles").select("id, full_name").in("id", rateIds)
      : { data: [] };
    if (profileError) throw profileError;
    const rateNameMap = Object.fromEntries((rateProfs ?? []).map((p) => [p.id, p.full_name]));
    ok(res, {
      range: { from: nf.value, to: nt.value },
      rows,
      totals,
      rates: (teacherRows ?? []).map((t) => ({
        teacher_id: t.profile_id,
        teacher_name: rateNameMap[t.profile_id] ?? "",
        hourly_pay: Number(t.hourly_pay ?? 0),
        pay_currency: t.pay_currency ?? "PHP",
      })),
    });
    return;
  }

  // POST /finance/payroll/rate  { teacher_id, hourly_pay }
  if (req.method === "POST" && url.pathname === "/payroll/rate") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const teacherId = String(body.teacher_id || "");
    const hourlyPay = Number(body.hourly_pay);
    if (!/^[0-9a-f-]{36}$/i.test(teacherId) || !Number.isFinite(hourlyPay) || hourlyPay < 0) {
      badRequest(res, "参数不合法");
      return;
    }
    // 老师课酬单价改动。写操作一律走 lib/rest.js —— supabase-js 的 .update()
    // 在 Workers 上会静默 no-op, 而手写 PostgREST 又会与 restPatch 各维护一套
    // header/错误处理。这里原来就是手写的那一份, 现在收敛。
    if (require("../lib/secureStore.js").ready()) {
      const pricing = require("../lib/payrollPricing.js");
      const config = await pricing.config();
      if (config.teachers[teacherId]) {
        badRequest(res, "请在价格设置中修改默认课酬");
        return;
      }
      const current = await admin
        .from("teachers")
        .select("*")
        .eq("profile_id", teacherId)
        .maybeSingle();
      if (current.error) throw current.error;
      if (current.data) await pricing.freezeLegacy(current.data);
    }
    const rows = await restPatch("teachers", { profile_id: teacherId }, { hourly_pay: hourlyPay });
    const updated = Array.isArray(rows) ? rows.length : 0;
    // 匹配到 0 行必须报错。PATCH 打到不存在的行时 PostgREST 依然返回 200,
    // 前端就会弹「课酬单价已更新」—— 单价没变、老师以为改好了, 到结算才发现。
    // 实测踩过: 传的是 teachers.id 而不是 profile_id, 就是这种假成功。
    if (updated === 0) {
      notFound(res, "找不到该老师（teacher_id 应为 profile_id）");
      return;
    }
    ok(res, { updated });
    return;
  }

  // GET /finance/student/:id
  const mStu = url.pathname.match(/^\/student\/([^/]+)$/);
  if (req.method === "GET" && mStu) {
    const id = mStu[1];
    const { data: stu } = await admin
      .from("students")
      .select("id, full_name, status, created_at")
      .eq("id", id)
      .maybeSingle();
    if (!stu) {
      badRequest(res, "学员不存在");
      return;
    }

    const { data: pkgs } = await admin
      .from("student_packages")
      .select(
        "id, total_hours, remaining_hours, purchased_at, expires_at, notes, package_types(name, price_cents)",
      )
      .eq("student_id", id)
      .order("purchased_at", { ascending: false });

    const { data: txs } = await admin
      .from("lesson_transactions")
      .select("id, delta, reason, note, created_at, lesson_id")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: pays } = await admin
      .from("package_payments")
      .select("id, student_package_id, amount_cents, method, paid_at, notes")
      .eq("student_id", id)
      .order("paid_at", { ascending: false });

    const totalSpent = (pays ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);

    ok(res, {
      student: stu,
      packages: pkgs ?? [],
      transactions: txs ?? [],
      payments: pays ?? [],
      total_paid_cents: totalSpent,
    });
    return;
  }

  badRequest(res, "unknown finance route");
};
