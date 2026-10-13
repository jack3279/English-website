const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, forbidden, notFound, badRequest } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch } = require("../lib/rest.js");
const { z } = require("zod");
const { record: audit } = require("../lib/audit.js");
const { canSeeStudent } = require("../lib/scoping.js");

const ListFeedsInput = z.object({
  studentId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

// 分两步查询: parent_student_links -> parents (避免 !inner join 复杂语法)
// 注意: parent_student_links 复合主键 (parent_id, student_id), 无 id 列
async function parentOwnsStudent(admin, userId, studentId) {
  const { data: parents } = await admin
    .from("parents")
    .select("id, profile_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (!parents) return false;
  const { data: link } = await admin
    .from("parent_student_links")
    .select("parent_id")
    .eq("parent_id", parents.id)
    .eq("student_id", studentId)
    .maybeSingle();
  return !!link;
}

async function listFeeds(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "parent", "admin", "teacher");
  const url = new URL(req.url, "http://x");
  const sp = Object.fromEntries(url.searchParams);
  const parsed = ListFeedsInput.safeParse(sp);
  if (!parsed.success) {
    badRequest(res, "参数不合法", { ...parsed.error.flatten(), debug: { sp, url: req.url } });
    return;
  }
  const { studentId, page, pageSize } = parsed.data;

  const admin = getAdmin();
  if (!(await canSeeStudent(req, studentId))) {
    forbidden(res, "无权查看该学员反馈");
    return;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await admin
    .from("parent_feeds")
    .select("id, record_id, student_id, summary, published_at", { count: "exact" })
    .eq("student_id", studentId)
    .order("published_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  // parent_feeds 只存了一行扁平 summary("学习…；表现…；作业…")。
  // 家长真正要看的是分栏的课堂报告, 所以这里按 record_id 回 records 补齐
  // content / performance / homework / next_plan, 再顺带带出上课时间与老师。
  // 不给 parent_feeds 加冗余列: 加列意味着两处数据要保持一致, 迟早对不上。
  const rows = data ?? [];
  const recordIds = rows.map((r) => r.record_id).filter(Boolean);

  const detail = new Map();
  let allowedRecordIds = null;
  if (recordIds.length) {
    const { data: allRecs } = await admin
      .from("records")
      .select("id, content, performance, homework, next_plan, created_at, lesson_id")
      .in("id", recordIds);
    const lessonIds = (allRecs ?? []).map((r) => r.lesson_id).filter(Boolean);
    const lessonMap = new Map();
    let recs = allRecs ?? [];
    if (lessonIds.length) {
      let lessonQuery = admin
        .from("lessons")
        .select("id, scheduled_at, duration_min, teacher_id, status, leave_status, history_settled")
        .in("id", lessonIds);
      if (req.context.role === "teacher") lessonQuery = lessonQuery.eq("teacher_id", req.context.userId);
      const { data: lessons } = await lessonQuery;
      for (const l of lessons ?? []) lessonMap.set(l.id, l);
      if (req.context.role === "teacher") {
        recs = recs.filter((r) => r.lesson_id && lessonMap.has(r.lesson_id));
      }
    } else if (req.context.role === "teacher") {
      recs = [];
    }
    if (req.context.role === "teacher") allowedRecordIds = new Set(recs.map((r) => r.id));
    const teacherIds = [...lessonMap.values()].map((l) => l.teacher_id).filter(Boolean);
    const teacherMap = new Map();
    if (teacherIds.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", [...new Set(teacherIds)]);
      for (const p of profs ?? []) teacherMap.set(p.id, p.full_name ?? null);
    }
    for (const r of recs ?? []) {
      const les = lessonMap.get(r.lesson_id);
      detail.set(r.id, {
        content: r.content ?? "",
        performance: r.performance ?? "",
        homework: r.homework ?? "",
        next_plan: r.next_plan ?? "",
        lesson_id: r.lesson_id ?? null,
        scheduled_at: les?.scheduled_at ?? null,
        ...(les?.history_settled ? {history_settled:true} : {}),
        duration_min: les?.duration_min ?? null,
        attendance_status: les?.leave_status === "approved" ? "leave" : les?.status ?? null,
        teacher_id: les?.teacher_id ?? null,
        teacher_name: les?.teacher_id ? (teacherMap.get(les.teacher_id) ?? null) : null,
      });
    }
  }

  const visibleRows =
    req.context.role === "teacher"
      ? rows.filter((f) => f.record_id && allowedRecordIds?.has(f.record_id))
      : rows;
  const items = visibleRows.map((f) => ({
    id: f.id,
    record_id: f.record_id,
    student_id: f.student_id,
    summary: f.summary,
    published_at: f.published_at,
    ...(detail.get(f.record_id) ?? {
      content: "",
      performance: "",
      homework: "",
      next_plan: "",
      lesson_id: null,
      scheduled_at: null,
      duration_min: null,
      teacher_id: null,
      teacher_name: null,
    }),
  }));

  ok(res, items, { page, pageSize, total: count ?? rows.length });
}

async function upcoming(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "parent");
  const admin = getAdmin();
  const { data: parent } = await admin
    .from("parents")
    .select("id")
    .eq("profile_id", req.context.userId)
    .maybeSingle();
  if (!parent) {
    ok(res, []);
    return;
  }
  const { data: links } = await admin
    .from("parent_student_links")
    .select("student_id")
    .eq("parent_id", parent.id);
  const ids = (links ?? []).map((l) => l.student_id);
  if (ids.length === 0) {
    ok(res, []);
    return;
  }
  const { data, error } = await admin
    .from("lessons")
    .select(
      "id, student_id, scheduled_at, duration_min, status, leave_status, leave_reason, students:student_id(full_name), profiles:teacher_id(full_name), courses:course_id(name,meeting_url)",
    )
    .in("student_id", ids)
    .gte("scheduled_at", new Date().toISOString())
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  ok(res, data ?? []);
}

const LeaveInput = z.object({
  reason: z.string().min(1).max(500),
});

async function leave(req, res, lessonId) {
  await requireAuth(req, res);
  requireRole(req, res, "parent");
  const parsed = LeaveInput.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const admin = getAdmin();

  const { data: lesson } = await admin
    .from("lessons")
    .select("id, student_id, status")
    .eq("id", lessonId)
    .single();
  if (!lesson) {
    notFound(res, "课次不存在");
    return;
  }

  const owns = await parentOwnsStudent(admin, req.context.userId, lesson.student_id);
  if (!owns) {
    forbidden(res, "无权操作该课次");
    return;
  }

  const next = Object.create(req);
  next.url = "/";
  next.body = { student_id: lesson.student_id, lesson_id: lessonId, reason: parsed.data.reason };
  const output = Object.create(res);
  output.status = (code) => {
    res.status(code);
    return output;
  };
  output.json = (payload) =>
    res.json(
      payload.data
        ? {
            ...payload,
            data: {
              ...lesson,
              leave_status: "pending",
              leave_reason: payload.data.reason || parsed.data.reason,
              leave_request_id: payload.data.id,
            },
          }
        : payload,
    );
  return require("./leave.js")(next, output);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  if (path === "/feeds" && req.method === "GET") return listFeeds(req, res);
  if (path === "/lessons/upcoming" && req.method === "GET") return upcoming(req, res);
  const m = path.match(/^\/lessons\/([0-9a-f-]+)\/leave$/);
  if (m && req.method === "POST") return leave(req, res, m[1]);
  throw new HttpError(404, "NOT_FOUND", "unknown parent route");
};
