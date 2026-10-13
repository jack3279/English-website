// /courses 规律课模板 (B 版 courses 已是模板: weekday + start_time + duration)
// 生成具体课节走 POST /schedules/generate
const { ok, badRequest, forbidden, notFound } = require("../lib/http.js");
const { requireAuth } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restInsert } = require("../lib/rest.js");
const { canSeeStudent, visibleStudentIds } = require("../lib/scoping.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");

const UUID = /^[0-9a-f-]{36}$/i;
const SELECT =
  "id,name,teacher_id,student_id,branch_id,weekday,start_time,duration_min,type,capacity,price_per_hour_cents,active,recurrence,start_date,end_date,meeting_url,room,created_at";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const CreateInput = z.object({
  name: z.string().min(1).max(80),
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid().optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  duration_min: z.coerce.number().int().min(15).max(240).default(60),
  recurrence: z.enum(["weekly", "biweekly", "monthly", "once", "none"]).default("weekly"),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  meeting_url: z.string().max(500).optional().nullable(),
  room: z.string().max(50).optional().nullable(),
});

const UpdateInput = CreateInput.partial();

function body(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body || {};
}

async function list(req, res) {
  await requireAuth(req, res);
  const { role, userId } = req.context;
  const admin = getAdmin();
  let q = admin.from("courses").select(SELECT).order("weekday").order("start_time");
  if (role === "teacher") {
    q = q.eq("teacher_id", userId);
  } else if (role === "parent") {
    const ids = await visibleStudentIds(req);
    if (!ids || ids.length === 0) {
      ok(res, { items: [], total: 0 });
      return;
    }
    q = q.in("student_id", ids);
  }
  const { data, error } = await q.limit(200);
  if (error) throw error;
  let rows = data ?? [];
  // 家长不看课酬单价与教师私有会议链接
  if (role === "parent") {
    rows = rows.map(({ price_per_hour_cents: _p, meeting_url: _m, ...r }) => r);
  }
  ok(res, { items: rows, total: rows.length });
}

async function create(req, res) {
  await requireAuth(req, res);
  if (!["admin", "teacher"].includes(req.context.role)) {
    forbidden(res, "只有 admin/teacher 可以创建课程模板");
    return;
  }
  const parsed = CreateInput.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const input = parsed.data;
  const { role, userId, branchId } = req.context;
  // 教师只能为自己建课，且只能给可见的学生排课
  if (role === "teacher") {
    input.teacher_id = userId;
    if (input.student_id && !(await canSeeStudent(req, input.student_id))) {
      forbidden(res, "该学员不在你的可见范围内");
      return;
    }
  }
  // 校验目标教师存在且在职
  const teacherRes = await getAdmin()
    .from("teachers")
    .select("profile_id,active,branch_id")
    .eq("profile_id", input.teacher_id)
    .maybeSingle();
  if (teacherRes.error) {
    badRequest(res, "教师读取失败");
    return;
  }
  if (!teacherRes.data) {
    badRequest(res, "教师不存在");
    return;
  }
  if (teacherRes.data.active === false) {
    badRequest(res, "该教师已停用");
    return;
  }
  const row = { ...input, branch_id: input.branch_id || branchId || teacherRes.data.branch_id || null };
  const rows = await restInsert("courses", row);
  if (!rows?.length) {
    badRequest(res, "课程模板创建失败");
    return;
  }
  await audit(
    req.context.userId,
    "course.create",
    "course",
    rows[0].id,
    { name: rows[0].name },
    req.reqId,
  );
  ok(res, rows[0]);
}

async function update(req, res, id) {
  await requireAuth(req, res);
  if (!["admin", "teacher"].includes(req.context.role)) {
    forbidden(res, "只有 admin/teacher 可以修改课程模板");
    return;
  }
  if (!UUID.test(id)) {
    badRequest(res, "id 不合法");
    return;
  }
  const parsed = UpdateInput.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) {
    badRequest(res, "没有需要更新的字段");
    return;
  }
  if (req.context.role === "teacher") {
    delete patch.teacher_id;
    delete patch.branch_id;
    if (patch.student_id && !(await canSeeStudent(req, patch.student_id))) {
      forbidden(res, "该学员不在你的可见范围内");
      return;
    }
  } else if (patch.teacher_id) {
    const teacherRes = await getAdmin()
      .from("teachers")
      .select("profile_id,active")
      .eq("profile_id", patch.teacher_id)
      .maybeSingle();
    if (teacherRes.error || !teacherRes.data) {
      badRequest(res, "教师不存在");
      return;
    }
    if (teacherRes.data.active === false) {
      badRequest(res, "该教师已停用");
      return;
    }
  }
  const filter = req.context.role === "teacher" ? { id, teacher_id: req.context.userId } : { id };
  const rows = await restPatch("courses", filter, patch);
  if (!rows?.length) {
    notFound(res, "课程模板不存在");
    return;
  }
  await audit(req.context.userId, "course.update", "course", id, patch, req.reqId);
  ok(res, rows[0]);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const seg = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (req.method === "GET") return list(req, res);
  if (req.method === "POST") return create(req, res);
  if (req.method === "PATCH" && seg) return update(req, res, seg);
  forbidden(res, "unknown courses route");
};

module.exports.WEEKDAYS = WEEKDAYS;
