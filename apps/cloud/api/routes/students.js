const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, notFound, forbidden, badRequest } = require("../lib/http.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restInsert } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const adminConfirmation = require("../lib/adminConfirmation.js");
const { z } = require("zod");
const { visibleStudentIds, canSeeStudent } = require("../lib/scoping.js");
const { HttpError } = require("../lib/errors.js");

const PAGE_SIZE_DEFAULT = 20;

// 学员五状态：在读 / 停课 / 休学 / 结课 / 退费。仅 active 参与预警与续费提醒。
const STUDENT_STATUSES = ["active", "inactive", "leave", "graduated", "refunded"];
// 删除级联计数字段（顺序即展示顺序）。
const PURGE_COUNT_FIELDS = [
  "lessons",
  "records",
  "parent_feeds",
  "lesson_transactions",
  "package_payments",
  "student_packages",
  "parent_student_links",
  "leave_requests",
  "makeups",
  "notifications",
  "notification_reads",
  "materials",
];

async function list(req, res) {
  await requireAuth(req, res);
  const { role } = req.context;
  const url = new URL(req.url, "http://x");
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") || PAGE_SIZE_DEFAULT));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = getAdmin();
  let q = admin
    .from("students")
    .select("id, full_name, birth_date, branch_id, status, notes, wecom_external_user_id", {
      count: "exact",
    });

  if (role !== "admin") {
    const ids = await visibleStudentIds(req);
    if (ids.length === 0) {
      ok(res, [], { page, pageSize, total: 0 });
      return;
    }
    q = admin
      .from("students")
      .select("id, full_name, birth_date, branch_id, status, notes, wecom_external_user_id", {
        count: "exact",
      })
      .in("id", ids);
  }

  // 模糊搜「姓名 / 备注」：放在角色分支之后，对 admin/teacher/parent 都生效
  // （家长分支会重建查询，原先写在前面会被丢掉）。用于学员页与 Topbar 全局搜索。
  const search = (url.searchParams.get("search") || "").trim();
  if (search) {
    // 转义 PostgREST 特殊字符：% _ 是通配，\ 是转义符，.or 串里逗号是分隔符。
    const esc = search
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/,/g, "\\,");
    q = q.or(`full_name.ilike.%${esc}%,notes.ilike.%${esc}%`);
  }

  const { data, count, error } = await q.order("full_name").range(from, to);
  if (error) throw error;

  const ids = (data ?? []).map((s) => s.id);
  let balances = {};
  if (ids.length) {
    const { data: b, error: balanceError } = await admin
      .from("student_balance")
      .select("student_id, remaining_hours")
      .in("student_id", ids);
    if (balanceError) throw balanceError;
    for (const r of b ?? []) balances[r.student_id] = Number(r.remaining_hours);
  }

  let courseNames = null;
  if (ids.length) {
    const courses = await admin.from("courses").select("student_id,name").in("student_id", ids);
    if (!courses.error) {
      courseNames = new Map();
      for (const c of courses.data || [])
        if (c.student_id && c.name)
          courseNames.set(c.student_id, [...(courseNames.get(c.student_id) || []), c.name]);
    }
  }
  const rows = (data ?? []).map((s) => ({
    ...s,
    ...(role === "parent" ? { notes: null } : {}),
    ...(role !== "admin" ? { wecom_external_user_id: null } : {}),
    course_names: courseNames ? courseNames.get(s.id) || [] : null,
    remaining_hours: balances[s.id] ?? 0,
  }));
  ok(res, rows, { page, pageSize, total: count ?? rows.length });
}

async function detail(req, res, id) {
  await requireAuth(req, res);
  if (!(await canSeeStudent(req, id))) {
    notFound(res, "学员不存在");
    return;
  }
  const admin = getAdmin();
  const { data, error } = await admin
    .from("students")
    .select("id, full_name, birth_date, branch_id, status, notes, wecom_external_user_id")
    .eq("id", id)
    .single();
  if (error || !data) {
    notFound(res, "学员不存在");
    return;
  }
  if (req.context.role === "parent") {
    data.notes = null;
    data.wecom_external_user_id = null;
  }

  const { data: txs } = await admin
    .from("lesson_transactions")
    .select("id, delta, reason, note, created_at, lesson_id")
    .eq("student_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: bal } = await admin
    .from("student_balance")
    .select("remaining_hours")
    .eq("student_id", id)
    .maybeSingle();

  const { data: packages } = await admin
    .from("student_packages")
    .select(
      "id, package_type_id, total_hours, remaining_hours, purchased_at, expires_at, notes, package_types(name, hours, price_cents)",
    )
    .eq("student_id", id)
    .order("purchased_at", { ascending: false });

  ok(res, {
    ...data,
    remaining_hours: bal?.remaining_hours ?? 0,
    transactions: txs ?? [],
    packages: packages ?? [],
  });
}

async function adjustHours(req, res, id) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const delta = Number(body.delta);
  const reason = String(body.reason || "");
  if (!Number.isFinite(delta) || delta === 0) {
    badRequest(res, "delta 必须是有效数字且不能为 0");
    return;
  }
  if (!reason.trim()) {
    badRequest(res, "请填写调整原因");
    return;
  }

  const admin = getAdmin();

  // 校验学员存在
  const { data: stu } = await admin.from("students").select("id").eq("id", id).maybeSingle();
  if (!stu) {
    notFound(res, "学员不存在");
    return;
  }

  // 查当前余额, 防止扣成大负数 (最多允许 -100h, 给教务调整余地)
  const { data: bal } = await admin
    .from("student_balance")
    .select("remaining_hours")
    .eq("student_id", id)
    .maybeSingle();
  const current = Number(bal?.remaining_hours ?? 0);
  if (current + delta < -100) {
    badRequest(res, `调整后余额 (${current + delta}h) 过低, 不允许低于 -100h`);
    return;
  }

  // 写 lesson_transactions (delta: + 充值, - 扣减)
  const { data: tx, error: txErr } = await admin
    .from("lesson_transactions")
    .insert({
      student_id: id,
      delta,
      reason: "adjust",
      note: reason.trim(),
      created_by: req.context.userId,
    })
    .select("id, delta, reason, note, created_at")
    .maybeSingle();
  if (txErr) throw txErr;

  await audit(
    req.context.userId,
    "student.adjust_hours",
    "student",
    id,
    { delta, reason: reason.trim(), new_balance: current + delta },
    req.reqId,
  );

  ok(res, { transaction: tx, new_balance: current + delta });
}

const CreateStudent = z.object({
  full_name: z.string().min(1).max(50),
  birth_date: z.string().optional().nullable(),
  branch_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional().nullable(),
  status: z.enum(STUDENT_STATUSES).default("active"),
  // 家长的企业微信外部联系人 ID (客户联系消息收件人); 留空表示未绑定
  wecom_external_user_id: z.string().max(64).optional().nullable(),
});
const UpdateStudent = CreateStudent.partial();

async function createStudent(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const parsed = CreateStudent.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const row = { ...parsed.data, branch_id: parsed.data.branch_id || req.context.branchId };
  let data;
  try {
    data = (await restInsert("students", row))[0];
    if (!data) throw new Error("学员创建结果未确认");
  } catch (error) {
    badRequest(res, "学员创建失败，请核对资料后重试");
    return;
  }
  ok(res, data);
}

async function updateStudent(req, res, id) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const parsed = UpdateStudent.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const rows = await restPatch("students", { id }, parsed.data);
  const data = rows?.[0];
  if (!data) {
    notFound(res, "学员不存在");
    return;
  }
  ok(res, data);
}

// GET /students/status-counts?search=
// 每个状态的准确计数（含搜索），供学员页五个状态标签显示数量。
async function statusCounts(req, res) {
  await requireAuth(req, res);
  const { role } = req.context;
  const url = new URL(req.url, "http://x");
  const search = (url.searchParams.get("search") || "").trim();
  const esc = search
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "\\,");

  let ids = null; // null = admin，不限范围
  if (role !== "admin") {
    ids = await visibleStudentIds(req);
    if (ids.length === 0) {
      ok(res, { all: 0, active: 0, inactive: 0, leave: 0, graduated: 0, refunded: 0 });
      return;
    }
  }

  const admin = getAdmin();
  const counts = { all: 0, active: 0, inactive: 0, leave: 0, graduated: 0, refunded: 0 };
  await Promise.all(
    STUDENT_STATUSES.map(async (status) => {
      let q = admin.from("students").select("id", { count: "exact", head: true }).eq("status", status);
      if (ids) q = q.in("id", ids);
      if (search) q = q.or(`full_name.ilike.%${esc}%,notes.ilike.%${esc}%`);
      const { count, error } = await q;
      if (error) throw error;
      counts[status] = count ?? 0;
      counts.all += count ?? 0;
    }),
  );
  ok(res, counts);
}

// 调用级联删除 RPC，统一处理“函数未部署 / 学员不存在”的错误文案。
async function callPurgeRpc(fn, id) {
  const { data, error } = await getAdmin().rpc(fn, { p_student: id });
  if (error) {
    if (/STUDENT_NOT_FOUND|P0002/.test(String(error.message || error.code || ""))) {
      throw new HttpError(404, "STUDENT_NOT_FOUND", "学员不存在");
    }
    const signature = String(
      [error.code, error.message, error.hint, error.details].filter(Boolean).join(" | "),
    );
    if (
      /function .* does not exist|Could not find the function|PGRST202|42883|permission denied|42501/.test(
        signature,
      )
    ) {
      throw new HttpError(
        503,
        "PURGE_NOT_READY",
        "删除功能尚未就绪：请先在 Supabase 执行学员删除迁移 (20261014000003)",
      );
    }
    throw error;
  }
  return data;
}

// POST /students/:id/delete-preview —— 级联删除预览（只计数，不写库）。
async function deletePreview(req, res, id) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  if (!(await canSeeStudent(req, id))) {
    notFound(res, "学员不存在");
    return;
  }
  const data = await callPurgeRpc("purge_student_preview", id);
  ok(res, { dryRun: true, ...data });
}

// DELETE /students/:id —— 级联永久删除（清理假数据）。
// 需当前管理员密码二次确认；路径 UUID 已由 dataScope 校验正式/测试范围。
async function deleteStudent(req, res, id) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "需要 admin");
    return;
  }
  const body = req.body || {};
  if (body.confirmed !== true || !body.current_password) {
    badRequest(res, "请勾选确认并输入当前管理员密码");
    return;
  }
  if (!(await canSeeStudent(req, id))) {
    notFound(res, "学员不存在");
    return;
  }

  const { data: stu } = await getAdmin()
    .from("students")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  if (!stu) {
    notFound(res, "学员不存在");
    return;
  }

  // 密码错误会抛 HttpError，由 withErrorHandler 转成对应状态码。
  await adminConfirmation.verify(req, body.current_password);

  const counts = await callPurgeRpc("purge_student", id);

  await audit(
    req.context.userId,
    "student.hard_deleted",
    "student",
    id,
    {
      full_name: stu.full_name,
      ...Object.fromEntries(PURGE_COUNT_FIELDS.map((f) => [f, counts?.[f] ?? 0])),
    },
    req.reqId,
  );

  ok(res, {
    deleted: true,
    id,
    full_name: stu.full_name,
    caveat:
      "已永久删除学员及其课节、反馈、课时包、缴费、请假补课、通知和家长关联；家长账号保留。用删除前的旧备份恢复会把该学员补回。",
    ...counts,
  });
}

// GET /students/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD
// 学习报告: 周期内的上课次数 / 课时 / 出勤率 / 缺勤 / 请假
async function report(req, res, id) {
  await requireAuth(req, res);
  if (!(await canSeeStudent(req, id))) {
    notFound(res, "学员不存在");
    return;
  }
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = admin
    .from("lessons")
    .select(
      "id, scheduled_at, status, duration_min, leave_status, leave_reason, teacher_id, records(id, performance, homework, created_at)",
    )
    .eq("student_id", id)
    .order("scheduled_at", { ascending: false })
    .limit(500);
  if (from) q = q.gte("scheduled_at", `${from}T00:00:00+08:00`);
  if (to) q = q.lte("scheduled_at", `${to}T23:59:59+08:00`);
  const { data, error } = await q;
  if (error) throw error;

  const lessons = (data ?? []).map((lesson) => ({
    ...lesson,
    records: Array.isArray(lesson.records) ? [...lesson.records] : lesson.records,
  }));
  if (req.context.role === "parent") {
    const recordIds = lessons.flatMap((l) =>
      Array.isArray(l.records) ? l.records.map((r) => r.id) : l.records?.id ? [l.records.id] : [],
    );
    const published = recordIds.length
      ? await admin
          .from("parent_feeds")
          .select("record_id")
          .eq("student_id", id)
          .in("record_id", recordIds)
      : { data: [], error: null };
    if (published.error) throw published.error;
    const ids = new Set((published.data || []).map((f) => f.record_id));
    for (const lesson of lessons) {
      lesson.records = Array.isArray(lesson.records)
        ? lesson.records.filter((r) => ids.has(r.id))
        : ids.has(lesson.records?.id)
          ? lesson.records
          : null;
    }
  }
  const planned = lessons.filter((l) => l.status !== "cancelled");
  const done = lessons.filter((l) => l.status === "completed");
  const noShow = lessons.filter((l) => l.status === "no_show");
  const leaveApproved = lessons.filter((l) => l.leave_status === "approved");
  const hours = done.reduce((s, l) => s + (Number(l.duration_min) || 0) / 60, 0);

  // 老师名单单独查, 避免 join 在 teacher_id 为空时出问题
  const teacherIds = [...new Set(lessons.map((l) => l.teacher_id).filter(Boolean))];
  let teacherMap = {};
  if (teacherIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds);
    teacherMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  const { data: bal } = await admin
    .from("student_balance")
    .select("remaining_hours")
    .eq("student_id", id)
    .maybeSingle();

  ok(res, {
    range: { from: from || null, to: to || null },
    metrics: {
      planned: planned.length,
      completed: done.length,
      cancelled: lessons.length - planned.length,
      no_show: noShow.length,
      leave_approved: leaveApproved.length,
      hours: Math.round(hours * 100) / 100,
      attendance_rate: planned.length ? Math.round((done.length / planned.length) * 100) : null,
      remaining_hours: Number(bal?.remaining_hours ?? 0),
    },
    // records 可能是一对象(一对一)也可能是数组, 两种形态都兼容
    items: lessons.map((l) => {
      const rec = Array.isArray(l.records) ? l.records[0] : l.records;
      return {
        id: l.id,
        scheduled_at: l.scheduled_at,
        status: l.status,
        duration_min: l.duration_min,
        leave_status: l.leave_status,
        leave_reason: l.leave_reason,
        teacher_name: teacherMap[l.teacher_id] ?? null,
        performance: rec?.performance ?? null,
        homework: rec?.homework ?? null,
      };
    }),
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const mLedger = url.pathname.match(/^\/?([0-9a-f-]+)\/hour-ledger$/);
  if (mLedger && req.method === "GET") {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "parent");
    if (!(await canSeeStudent(req, mLedger[1]))) {
      notFound(res, "学员不存在");
      return;
    }
    ok(res, await require("../lib/studentHourLedger.js").build(mLedger[1]));
    return;
  }
  // GET /students/:id/report
  const mRep = url.pathname.match(/^\/?([0-9a-f-]+)\/report$/);
  if (mRep && req.method === "GET") return report(req, res, mRep[1]);
  // POST /students/:id/adjust-hours
  const mAdj = url.pathname.match(/^\/?([0-9a-f-]+)\/adjust-hours$/);
  if (mAdj && req.method === "POST") return adjustHours(req, res, mAdj[1]);
  // POST /students/:id/delete-preview
  const mDelPrev = url.pathname.match(/^\/?([0-9a-f-]+)\/delete-preview$/);
  if (mDelPrev && req.method === "POST") return deletePreview(req, res, mDelPrev[1]);
  const m = url.pathname.match(/^\/?([0-9a-f-]+)$/);
  if (m && req.method === "PATCH") return updateStudent(req, res, m[1]);
  if (m && req.method === "DELETE") return deleteStudent(req, res, m[1]);
  if (m) return detail(req, res, m[1]);
  // GET /students/status-counts
  if (url.pathname.replace(/^\/+/, "") === "status-counts" && req.method === "GET")
    return statusCounts(req, res);
  if (req.method === "POST") return createStudent(req, res);
  return list(req, res);
};
