// 课后反馈 / 课堂报告。
//
// 本机构所有课程都是**一对一**, 所以「班级报告」就是「某个学员某一节课的课后反馈」——
// 不存在按班聚合的场景。由此定了两条可见性规则:
//   · 家长: 只看老师**主动发布**的(= 写了 parent_feeds 的那些), 走 /parent/feeds。
//   · 管理员: 看全部, 包括老师没勾选"发布给家长"的 —— 那是质量抽查的主要对象。
//   · 老师: 只看自己上过的课。
// 也就是说管理员与家长的口径刻意不同: 家长看不见草稿, 管理员必须看得见。

const { withErrorHandler } = require("../lib/errors.js");
const { ok, badRequest, notFound, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { parseWindow, applyWindow } = require("../lib/window.js");
const { restInsert, restDelete } = require("../lib/rest.js");
const { buildSummary } = require("@cloud/domain");
const notify = require("../lib/notify.js");
const { positiveIntParam } = require("../lib/pagination.js");

const RECORD_COLS =
  "id, lesson_id, content, performance, homework, next_plan, created_at, created_by";

// !inner 是必须的: 要能用 lessons.xxx 过滤(老师/学员/时间), 且顺带排除孤儿记录。
const LESSON_EMBED =
  "lessons:lesson_id!inner(id, scheduled_at, duration_min, student_id, teacher_id, status)";

function isPublishedRow(row) {
  const feed = row.parent_feeds;
  return Array.isArray(feed) ? feed.length > 0 : Boolean(feed);
}

function applyReportScope(q, { role, userId, teacherId, studentId, win, published }) {
  if (role === "teacher") q = q.eq("lessons.teacher_id", userId);
  else if (teacherId) q = q.eq("lessons.teacher_id", teacherId);
  if (studentId) q = q.eq("lessons.student_id", studentId);
  q = applyWindow(q, "lessons.scheduled_at", win.fromIso, win.toIso);
  if (published === "no") q = q.is("parent_feeds.id", null);
  return q;
}

async function countPublishedReports(admin, scope) {
  const { count, error } = await applyReportScope(
    admin
      .from("records")
      .select(`id, ${LESSON_EMBED}, parent_feeds!inner(id)`, { count: "exact", head: true }),
    { ...scope, published: "yes" },
  );
  if (error) throw error;
  return count ?? 0;
}

async function names(admin, table, ids) {
  const uniq = [...new Set((ids ?? []).filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const { data } = await admin.from(table).select("id, full_name").in("id", uniq);
  return new Map((data ?? []).map((r) => [r.id, r.full_name ?? null]));
}

async function listReports(req, res) {
  const url = new URL(req.url, "http://x");
  const sp = url.searchParams;
  const { role, userId } = req.context;

  const win = parseWindow(sp.get("from"), sp.get("to"));
  if (win.bad) {
    badRequest(res, win.bad);
    return;
  }

  const page = positiveIntParam(sp.get("page"), 1, 100000);
  const pageSize = positiveIntParam(sp.get("pageSize"), 20, 50);
  const studentId = sp.get("studentId");
  const teacherId = sp.get("teacherId");
  const published = sp.get("published") || "all"; // all | yes | no
  if (!["all", "yes", "no"].includes(published)) {
    badRequest(res, "published 只能是 all / yes / no");
    return;
  }

  const admin = getAdmin();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const scope = { role, userId, teacherId, studentId, win, published };
  const feedEmbed =
    published === "yes"
      ? "parent_feeds!inner(id)"
      : "parent_feeds!left(id)";

  const listQuery = applyReportScope(
    admin.from("records").select(`${RECORD_COLS}, ${LESSON_EMBED}, ${feedEmbed}`, {
      count: "exact",
    }),
    scope,
  );

  const listResult = await listQuery
    .order("lessons(scheduled_at)", { ascending: false })
    .range(from, to);
  if (listResult.error) throw listResult.error;
  const publishedCount = await countPublishedReports(admin, scope);

  const rows = listResult.data ?? [];
  const count = listResult.count;

  const lessonIds = rows.map((r) => r.lesson_id).filter(Boolean);
  const studentMap = await names(
    admin,
    "students",
    rows.map((r) => r.lessons?.student_id),
  );
  const profileMap = await names(admin, "profiles", [
    ...rows.map((r) => r.lessons?.teacher_id),
    ...rows.map((r) => r.created_by),
  ]);

  let items = rows.map((r) => ({
    record_id: r.id,
    lesson_id: r.lesson_id,
    student_id: r.lessons?.student_id ?? null,
    student_name: studentMap.get(r.lessons?.student_id) ?? null,
    teacher_id: r.lessons?.teacher_id ?? null,
    teacher_name: profileMap.get(r.lessons?.teacher_id) ?? null,
    author_id: r.created_by ?? null,
    author_name: profileMap.get(r.created_by) ?? null,
    scheduled_at: r.lessons?.scheduled_at ?? null,
    duration_min: r.lessons?.duration_min ?? null,
    lesson_status: r.lessons?.status ?? null,
    content: r.content ?? "",
    performance: r.performance ?? "",
    homework: r.homework ?? "",
    next_plan: r.next_plan ?? "",
    published: isPublishedRow(r),
    created_at: r.created_at,
  }));

  ok(res, items, {
    page,
    pageSize,
    total: count ?? items.length,
    lessonIds: lessonIds.length,
    // 前端用它渲染「已发布 / 草稿」筛选的计数, 免得再发一次请求
    publishedCount,
  });
}

// 事后发布给家长：完课时忘勾「发布」的草稿，可在此补发 —— 否则家长永远看不到。
// POST /reports/:recordId/publish
async function publishReport(req, res, recordId) {
  const { role, userId } = req.context;
  const admin = getAdmin();

  const { data: rec } = await admin
    .from("records")
    .select(
      "id, content, performance, homework, lessons:lesson_id!inner(id, student_id, teacher_id)",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (!rec) {
    notFound(res, "反馈记录不存在");
    return;
  }
  const lesson = rec.lessons;
  // 老师只能发布自己那节课的反馈
  if (role === "teacher" && lesson.teacher_id !== userId) {
    forbidden(res, "只能发布自己课程的反馈");
    return;
  }

  // 幂等：已有 parent_feed 就直接回成功（重复点击不报错、不重复通知）
  const { data: existing } = await admin
    .from("parent_feeds")
    .select("id")
    .eq("record_id", recordId)
    .maybeSingle();
  if (existing) {
    ok(res, { published: true, idempotent: true });
    return;
  }

  const summary = buildSummary(rec);
  const rows = await restInsert("parent_feeds", {
    record_id: recordId,
    student_id: lesson.student_id,
    summary,
    published_at: new Date().toISOString(),
  });
  const feed = rows?.[0] ?? null;

  // 通知家长有新反馈（没绑家长则内部 no-op）
  await notify.pushToParents(
    lesson.student_id,
    { type: "report", title: "新的课后反馈", body: summary, link: "/parent" },
    { reqId: req.reqId, source: "reports.publish" },
  );

  ok(res, { published: true, id: feed?.id ?? null });
}

// 取消发布：从家长端撤回（删除 parent_feed；records 反馈本身保留）。
// DELETE /reports/:recordId/publish
async function unpublishReport(req, res, recordId) {
  const { role, userId } = req.context;
  const admin = getAdmin();

  if (role === "teacher") {
    const { data: rec } = await admin
      .from("records")
      .select("lessons:lesson_id!inner(teacher_id)")
      .eq("id", recordId)
      .maybeSingle();
    if (!rec) {
      notFound(res, "反馈记录不存在");
      return;
    }
    if (rec.lessons.teacher_id !== userId) {
      forbidden(res, "只能撤回自己课程的反馈");
      return;
    }
  }

  await restDelete("parent_feeds", { record_id: recordId });
  ok(res, { published: false });
}

module.exports = async function handler(req, res) {
  await withErrorHandler(async () => {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      return listReports(req, res);
    }

    // 事后发布 / 取消发布（path: /<recordId>/publish）
    const mPub = url.pathname.match(/^\/([0-9a-f-]+)\/publish$/);
    if (mPub && req.method === "POST") return publishReport(req, res, mPub[1]);
    if (mPub && req.method === "DELETE") return unpublishReport(req, res, mPub[1]);

    // 课节统计 (完课率/出勤率/取消率) —— 数据看板用
    // GET /reports/lesson-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
    // 响应:
    //   total_scheduled, completed, no_show, cancelled, pending
    //   completion_rate = completed / (total - cancelled)  (排除取消, 否则分母虚高)
    //   attendance_rate = (completed + no_show) / (total - cancelled)
    //   cancel_rate     = cancelled / total
    if (req.method === "GET" && url.pathname === "/lesson-stats") {
      return lessonStats(req, res);
    }

    // 按老师完课/出勤率排名
    if (req.method === "GET" && url.pathname === "/teacher-attendance") {
      return teacherAttendance(req, res);
    }

    const { HttpError } = require("../lib/errors.js");
    throw new HttpError(404, "NOT_FOUND", "unknown reports route");
  })(req, res);
};

// 课节聚合 —— 本月完课/出勤/取消
async function lessonStats(req, res) {
  const { ok, forbidden } = require("../lib/http.js");
  const { applyWindow, parseWindow } = require("../lib/window.js");
  const { getAdmin } = require("../lib/supabase.js");
  if (req.context.role !== "admin") {
    forbidden(res, "只有管理员可以查看全机构课节统计");
    return;
  }

  const url = new URL(req.url, "http://x");
  const win = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
  if (win.bad) {
    const { badRequest } = require("../lib/http.js");
    badRequest(res, win.bad);
    return;
  }

  const admin = getAdmin();
  // 按 scheduled_at 落在窗口内; 一次只 select status, 最多 5000 条够 admin 用
  const { data, error } = await applyWindow(
    admin.from("lessons").select("status", { count: "exact" }),
    "scheduled_at",
    win.fromIso,
    win.toIso,
  ).limit(5000);
  if (error) throw error;

  const rows = data ?? [];
  const counts = { completed: 0, no_show: 0, cancelled: 0, scheduled: 0 };
  for (const r of rows) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
  }
  const total = rows.length;
  const active = total - counts.cancelled; // 排除已取消
  const completion_rate = active > 0 ? counts.completed / active : 0;
  const attendance_rate = active > 0 ? (counts.completed + counts.no_show) / active : 0;
  const cancel_rate = total > 0 ? counts.cancelled / total : 0;

  ok(res, {
    range: { from: win.from, to: win.to },
    total_scheduled: total,
    completed: counts.completed,
    no_show: counts.no_show,
    cancelled: counts.cancelled,
    pending: counts.scheduled,
    completion_rate,
    attendance_rate,
    cancel_rate,
  });
}

// 按老师聚合完课/出勤率 —— 给数据看板用
// GET /reports/teacher-attendance?from=&to=
// 响应: rows: [{ teacher_id, teacher_name, total_scheduled, completed, no_show, cancelled, completion_rate, attendance_rate, total_hours }]
// 仅返回至少有 1 节 "active" 课的老师 (排除全取消的噪声)
async function teacherAttendance(req, res) {
  const { ok, badRequest, forbidden } = require("../lib/http.js");
  const { applyWindow, parseWindow } = require("../lib/window.js");
  const { getAdmin } = require("../lib/supabase.js");
  if (req.context.role !== "admin") {
    forbidden(res, "只有管理员可以查看教师绩效排名");
    return;
  }

  const url = new URL(req.url, "http://x");
  const win = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
  if (win.bad) {
    badRequest(res, win.bad);
    return;
  }

  const admin = getAdmin();
  // 一次拉全字段, JS 端聚合
  const { data, error } = await applyWindow(
    admin
      .from("lessons")
      .select("teacher_id, status, duration_min, profiles:teacher_id(full_name)"),
    "scheduled_at",
    win.fromIso,
    win.toIso,
  ).limit(5000);
  if (error) throw error;

  const rows = data ?? [];
  const byTeacher = new Map();
  for (const r of rows) {
    if (!r.teacher_id) continue; // 没绑老师的孤儿课节忽略
    const cur = byTeacher.get(r.teacher_id) ?? {
      teacher_id: r.teacher_id,
      teacher_name: r.profiles?.full_name ?? "",
      total_scheduled: 0,
      completed: 0,
      no_show: 0,
      cancelled: 0,
      total_hours: 0,
    };
    cur.total_scheduled += 1;
    if (r.status === "completed") {
      cur.completed += 1;
      cur.total_hours += Number(r.duration_min || 0) / 60;
    } else if (r.status === "no_show") {
      cur.no_show += 1;
    } else if (r.status === "cancelled") {
      cur.cancelled += 1;
    }
    byTeacher.set(r.teacher_id, cur);
  }

  // 排序 + 计算 rate
  const list = [...byTeacher.values()].map((t) => {
    const active = t.total_scheduled - t.cancelled;
    return {
      ...t,
      total_hours: Math.round(t.total_hours * 100) / 100,
      completion_rate: active > 0 ? t.completed / active : 0,
      attendance_rate: active > 0 ? (t.completed + t.no_show) / active : 0,
    };
  });
  // 按完课时数降序 (实际产出 > 完成率)
  list.sort((a, b) => b.total_hours - a.total_hours);

  ok(res, { range: { from: win.from, to: win.to }, rows: list });
}
