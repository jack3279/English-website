const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, badRequest, notFound, checkEnumParam } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const { CreateScheduleInput, UpdateScheduleInput } = require("@cloud/schema");
const { detect, ScheduleConflictError } = require("@cloud/domain");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const notify = require("../lib/notify.js");
const wecom = require("../src/wecom.js");
const { warn } = require("../lib/log.js");
const { fmtWhenShanghai } = require("../lib/window.js");
const { addScheduleChanges } = require("../lib/scheduleChanges.js");
const { z } = require("zod");
const { getSettings } = require("../lib/institutionSettings.js");

const TZ = "+08:00"; // 校区在 Asia/Shanghai, start_time 按本地时间解释

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 规律课模板在某天是否排课
function occursOn(course, d) {
  const dateStr = dayStr(d);
  if (course.start_date && dateStr < course.start_date) return false;
  if (course.end_date && dateStr > course.end_date) return false;
  if (d.getUTCDay() !== Number(course.weekday)) return false;
  switch (course.recurrence || "weekly") {
    case "weekly":
      return true;
    case "biweekly": {
      const anchor = course.start_date || dateStr;
      const weeks = Math.round(
        (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / (7 * 86400_000),
      );
      return weeks % 2 === 0;
    }
    case "monthly": {
      const anchorDay = Number(String(course.start_date || dateStr).slice(8, 10));
      return d.getUTCDate() === anchorDay;
    }
    case "once":
      return course.start_date ? dateStr === course.start_date : true;
    default:
      return false;
  }
}

async function list(req, res) {
  await requireAuth(req, res);
  const { role, userId } = req.context;
  const url = new URL(req.url, "http://x");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const teacherId = url.searchParams.get("teacherId");
  const studentId = url.searchParams.get("studentId");
  const status = url.searchParams.get("status"); // 单值: scheduled / completed / cancelled / no_show
  const statuses = url.searchParams.get("statuses"); // 多值逗号分隔: completed,cancelled,no_show

  const admin = getAdmin();
  let q = admin
    .from("lessons")
    .select(
      "id, course_id, teacher_id, student_id, scheduled_at, duration_min, status, completed_at, leave_status, leave_reason, history_settled,absence_review_status,absence_deduct_hours,absence_pay_teacher, students:student_id (full_name), profiles:teacher_id (full_name), courses:course_id(name,meeting_url)",
    )
    .order("scheduled_at", { ascending: url.searchParams.get("includeRecords") !== "true" });

  if (url.searchParams.get("absence_review") === "pending")
    q = q.eq("absence_review_status", "pending");
  if (from) q = q.gte("scheduled_at", from);
  if (to) q = q.lte("scheduled_at", to);
  if (teacherId) q = q.eq("teacher_id", teacherId);
  if (studentId) q = q.eq("student_id", studentId);

  // status 是 Postgres enum: 非法值会让 PostgREST 的过滤器直接 500。
  // 客户端拼错一个 status 就把整个列表接口打挂, 所以这里先按白名单挡掉, 回 400。
  // （`statuses=` 全是空串时也走同一套, `.in([])` 同样会炸。）
  const VALID_STATUS = ["scheduled", "completed", "cancelled", "no_show"];
  if (!checkEnumParam(res, "status", status, VALID_STATUS)) return;
  if (status) q = q.eq("status", status);
  if (statuses) {
    const list = statuses
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = list.filter((s) => !VALID_STATUS.includes(s));
    if (invalid.length) {
      badRequest(res, `statuses 含非法值: ${invalid.join(",")}`, {
        allowed: VALID_STATUS,
      });
      return;
    }
    if (list.length) q = q.in("status", list);
  }

  if (role === "teacher") {
    q = q.eq("teacher_id", userId);
  } else if (role === "parent") {
    const { data: links } = await admin
      .from("parent_student_links")
      .select("student_id, parents!inner(profile_id)")
      .eq("parents.profile_id", userId);
    const ids = (links ?? []).map((l) => l.student_id);
    if (ids.length === 0) {
      ok(res, []);
      return;
    }
    q = q.in("student_id", ids);
  }

  const includeChanges = url.searchParams.get("includeChanges") === "true";
  const { data, error } = await q.limit(
    includeChanges || url.searchParams.get("includeRecords") === "true" ? 501 : 500,
  );
  if (error) throw error;
  const rows = (data ?? []).slice(0, 500);
  if (
    ["admin", "teacher"].includes(role) &&
    rows.length &&
    url.searchParams.get("includeRecords") === "true"
  ) {
    const records = await admin
      .from("records")
      .select("lesson_id,content")
      .in(
        "lesson_id",
        rows.map((l) => l.id),
      );
    if (records.error) throw records.error;
    const contents = new Map((records.data || []).map((r) => [r.lesson_id, r.content]));
    for (const row of rows) row.lesson_content = contents.get(row.id) || null;
  }
  let enriched = includeChanges ? await addScheduleChanges(admin, rows) : rows;
  if (req.context.role === "parent")
    enriched = enriched.map(({ absence_pay_teacher, ...row }) => row);
  ok(
    res,
    (data ?? []).length > 500
      ? enriched.map((row) => ({ ...row, schedule_list_truncated: true }))
      : enriched,
  );
}

async function create(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const parsed = CreateScheduleInput.safeParse({
    ...req.body,
    duration_min: req.body?.duration_min ?? (await getSettings()).defaultDurationMin,
  });
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const input = parsed.data;
  if (require("../lib/secureStore.js").ready() && !req.__teacherCalendarLock) {
    return require("../lib/teacherAvailability.js").withTeacherLocks(
      [input.teacher_id],
      async () => {
        req.__teacherCalendarLock = true;
        try {
          return await create(req, res);
        } finally {
          delete req.__teacherCalendarLock;
        }
      },
    );
  }
  await require("../lib/teacherAvailability.js").assertAvailable(input);

  const admin = getAdmin();
  const fromTs = new Date(new Date(input.scheduled_at).getTime() - 24 * 3600_000).toISOString();
  const toTs = new Date(new Date(input.scheduled_at).getTime() + 24 * 3600_000).toISOString();
  const { data: existing, error: conflictError } = await admin
    .from("lessons")
    .select("id, teacher_id, student_id, scheduled_at, duration_min, status")
    .gte("scheduled_at", fromTs)
    .lte("scheduled_at", toTs);

  if (conflictError) throw conflictError;
  const conflicts = detect({ newLesson: { ...input, id: "new" }, existingLessons: existing ?? [] });
  if (conflicts.length) throw new ScheduleConflictError(conflicts);

  const { data, error } = await admin
    .from("lessons")
    .insert({
      course_id: input.course_id ?? null,
      teacher_id: input.teacher_id,
      student_id: input.student_id,
      scheduled_at: input.scheduled_at,
      duration_min: input.duration_min,
      status: "scheduled",
    })
    .select()
    .single();
  if (error) throw error;

  await audit(req.context.userId, "schedule.create", "lesson", data.id, input, req.reqId);
  ok(res, data);
}

// 改期 / 取消课节后通知家长与老师。
//
// 之前这两件事**一个通知都不发**：家长和老师只能靠自己想起来去翻课程表 ——
// 改期最常见的后果就是有人跑空趟。通知基础设施（站内通知 + 企微）早就有了，
// 只是排课这条路没接上。
async function lessonWithNames(lessonId) {
  const admin = getAdmin();
  const { data } = await admin
    .from("lessons")
    .select(
      "id, scheduled_at, duration_min, status, student_id, teacher_id, students:student_id (full_name), profiles:teacher_id (full_name)",
    )
    .eq("id", lessonId)
    .maybeSingle();
  return data;
}

const { notifyLessonChanged } = require("../lib/lessonChanged.js");

async function update(req, res, id) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const parsed = UpdateScheduleInput.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const input = parsed.data;

  const admin = getAdmin();
  const { data: current, error: currentError } = await admin
    .from("lessons")
    .select("*")
    .eq("id", id)
    .single();
  if (currentError && currentError.code !== "PGRST116") throw currentError;
  if (!current) {
    notFound(res, "课次不存在");
    return;
  }

  if ((await require("../lib/absence.js").get(id))?.state === "pending")
    throw new HttpError(409, "ATTENDANCE_PENDING", "考勤处理未完成，不能同时调整课程");
  if (input.status && input.status !== current.status && input.status !== "cancelled")
    throw new HttpError(400, "ATTENDANCE_REQUIRED", "请通过考勤与完课流程处理课程状态");
  if (
    input.status === "cancelled" &&
    current.status !== "scheduled" &&
    current.status !== "cancelled"
  )
    throw new HttpError(
      409,
      "LESSON_ALREADY_HANDLED",
      "已完成考勤的课程不能直接取消，请先核对课时及课酬",
    );
  if (
    input.student_id &&
    input.student_id !== current.student_id &&
    require("../lib/secureStore.js").ready()
  ) {
    const linked = await admin.from("makeups").select("id").eq("makeup_lesson_id", id).limit(1);
    if (linked.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "补课关系检查失败");
    if (linked.data?.length) throw new HttpError(400, "MAKEUP_STUDENT", "补课课节不能移给其他学生");
  }
  if (input.scheduled_at || input.teacher_id || input.student_id || input.duration_min) {
    if (current.status !== "scheduled")
      throw new HttpError(409, "LESSON_NOT_SCHEDULED", "只能调整待上课的课程");
    const merged = { ...current, ...input, id };
    const fromTs = new Date(new Date(merged.scheduled_at).getTime() - 24 * 3600_000).toISOString();
    const toTs = new Date(new Date(merged.scheduled_at).getTime() + 24 * 3600_000).toISOString();
    const { data: existing, error: conflictError } = await admin
      .from("lessons")
      .select("id, teacher_id, student_id, scheduled_at, duration_min, status")
      .neq("id", id)
      .gte("scheduled_at", fromTs)
      .lte("scheduled_at", toTs);
    if (conflictError) throw conflictError;
    if (require("../lib/secureStore.js").ready() && !req.__teacherCalendarLock)
      return require("../lib/teacherAvailability.js").withTeacherLocks(
        [current.teacher_id, merged.teacher_id],
        async () => {
          req.__teacherCalendarLock = true;
          try {
            return await update(req, res, id);
          } finally {
            delete req.__teacherCalendarLock;
          }
        },
      );
    await require("../lib/teacherAvailability.js").assertAvailable(merged);
    const conflicts = detect({ newLesson: merged, existingLessons: existing ?? [] });
    if (conflicts.length) throw new ScheduleConflictError(conflicts);
  }

  // 走 raw PostgREST PATCH: supabase-js 的 .update() 在 Workers 上静默 no-op
  const rows = await restPatch("lessons", { id, status: current.status }, input);
  if (!rows?.length) {
    notFound(res, "课次不存在");
    return;
  }
  if (require("../lib/secureStore.js").ready())
    await require("../lib/makeupWorkflow.js").syncLesson({ ...current, ...input });
  await audit(
    req.context.userId,
    "schedule.update",
    "lesson",
    id,
    {
      ...input,
      previous_scheduled_at: current.scheduled_at,
      schedule_changed: !!(
        (input.scheduled_at &&
          Date.parse(input.scheduled_at) !== Date.parse(current.scheduled_at)) ||
        (input.teacher_id && input.teacher_id !== current.teacher_id) ||
        (input.student_id && input.student_id !== current.student_id) ||
        (input.duration_min && input.duration_min !== current.duration_min)
      ),
    },
    req.reqId,
  );

  // 时间、老师或时长变化会影响上课安排，沿用调课通知流程。
  const timeChanged =
    input.scheduled_at &&
    new Date(input.scheduled_at).getTime() !== new Date(current.scheduled_at).getTime();
  const teacherChanged = input.teacher_id && input.teacher_id !== current.teacher_id;
  const durationChanged = input.duration_min && input.duration_min !== current.duration_min;
  if (timeChanged || teacherChanged || durationChanged) {
    const fresh = await lessonWithNames(id);
    await notifyLessonChanged(req, fresh, {
      previousAt: current.scheduled_at,
      previousDuration: current.duration_min,
    });
  }

  ok(res, rows[0]);
}

const GenerateInput = z.object({
  course_id: z.string().uuid().optional().nullable(),
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
});

// POST /schedules/generate  把规律课模板展开成具体课节
// 幂等: 已存在的 (course_id, 日期) 跳过; 冲突的课节跳过并汇报
async function generate(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const parsed = GenerateInput.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const { course_id, from, to } = parsed.data;
  if (from > to) {
    badRequest(res, "from 不能晚于 to");
    return;
  }
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 62) {
    badRequest(res, "一次最多生成 62 天 (Workers CPU 10ms 限制)");
    return;
  }

  const admin = getAdmin();
  const COURSE_COLS =
    "id,name,teacher_id,student_id,weekday,start_time,duration_min,active,recurrence,start_date,end_date,meeting_url";
  const { data: courses, error: cErr } = course_id
    ? await admin.from("courses").select(COURSE_COLS).eq("id", course_id)
    : await admin.from("courses").select(COURSE_COLS).eq("active", true);
  if (cErr) throw cErr;
  const templates = (courses ?? []).filter((c) => (c.recurrence || "weekly") !== "none");
  if (!templates.length) {
    ok(res, { created: 0, skipped_existing: 0, skipped_conflict: 0, conflicts: [] });
    return;
  }

  if (require("../lib/secureStore.js").ready() && !req.__teacherCalendarLock) {
    const ids = [...new Set(templates.map((c) => c.teacher_id))];
    if (ids.length > 10)
      throw new HttpError(400, "TEACHER_BATCH_LIMIT", "一次最多生成10位教师的课表，请分批选择课程");
    return require("../lib/teacherAvailability.js").withTeacherLocks(ids, async () => {
      req.__teacherCalendarLock = true;
      try {
        return await generate(req, res);
      } finally {
        delete req.__teacherCalendarLock;
      }
    });
  }
  const fromTs = `${from}T00:00:00${TZ}`;
  const toTs = `${to}T23:59:59.999${TZ}`;
  const { data: existing, error: lErr } = await admin
    .from("lessons")
    .select("id, course_id, teacher_id, student_id, scheduled_at, duration_min, status")
    .gte("scheduled_at", fromTs)
    .lte("scheduled_at", toTs);
  if (lErr) throw lErr;
  const existingLessons = existing ?? [];
  // 已生成过的 (course_id, 当地日期) 组合
  const seen = new Set(
    existingLessons
      .filter((l) => l.course_id)
      .map(
        (l) =>
          `${l.course_id}|${new Date(l.scheduled_at).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })}`,
      ),
  );

  const candidates = [];
  for (const c of templates) {
    if (c.start_date && c.start_date > to) continue;
    if (c.end_date && c.end_date < from) continue;
    for (
      let t = Date.parse(`${from}T00:00:00Z`);
      t <= Date.parse(`${to}T00:00:00Z`);
      t += 86400_000
    ) {
      const d = new Date(t);
      if (!occursOn(c, d)) continue;
      const dateStr = dayStr(d);
      if (seen.has(`${c.id}|${dateStr}`)) continue;
      candidates.push({
        course_id: c.id,
        teacher_id: c.teacher_id,
        student_id: c.student_id,
        scheduled_at: `${dateStr}T${String(c.start_time).slice(0, 5)}:00${TZ}`,
        duration_min: c.duration_min ?? 60,
        status: "scheduled",
        meeting_url: c.meeting_url ?? null,
      });
    }
  }

  const availabilityByTeacher = new Map();
  for (const id of new Set(candidates.map((c) => c.teacher_id)))
    availabilityByTeacher.set(id, await require("../lib/teacherAvailability.js").get(id));
  const conflicts = [];
  const toInsert = [];
  for (const cand of candidates) {
    const unavailable = require("../lib/teacherAvailability.js").check(
      availabilityByTeacher.get(cand.teacher_id),
      cand,
    );
    if (unavailable) {
      conflicts.push({ scheduled_at: cand.scheduled_at, reason: unavailable });
      continue;
    }
    const hit = detect({ newLesson: { ...cand, id: "new" }, existingLessons });
    if (hit.length) {
      conflicts.push(...hit.map((h) => ({ ...h, scheduled_at: cand.scheduled_at })));
      continue;
    }
    toInsert.push(cand);
    existingLessons.push(cand); // 同批内也去重
  }

  let inserted = [];
  if (toInsert.length) {
    const { data, error } = await admin.from("lessons").insert(toInsert).select("id");
    if (error) throw error;
    inserted = data ?? [];
  }

  await audit(
    req.context.userId,
    "schedule.generate",
    "course",
    course_id || null,
    { from, to, created: inserted.length, conflicts: conflicts.length },
    req.reqId,
  );

  ok(res, {
    created: inserted.length,
    skipped_existing: candidates.length - toInsert.length - conflicts.length,
    skipped_conflict: conflicts.length,
    conflicts: conflicts.slice(0, 20),
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const idMatch = url.pathname.match(/^\/?([0-9a-f-]+)$/);
  if (
    idMatch &&
    ["PATCH", "DELETE"].includes(req.method) &&
    !req.__scheduleLessonLock &&
    require("../lib/secureStore.js").ready()
  ) {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    return require("../lib/workflowLock.js").withLock(`lesson-${idMatch[1]}`, async () => {
      req.__scheduleLessonLock = true;
      try {
        return await handler(req, res);
      } finally {
        delete req.__scheduleLessonLock;
      }
    });
  }
  if (req.method === "GET" && !idMatch) return list(req, res);
  if (req.method === "POST" && url.pathname === "/generate") return generate(req, res);
  if (req.method === "POST" && !idMatch) return create(req, res);
  if (req.method === "PATCH" && idMatch) return update(req, res, idMatch[1]);
  if (req.method === "DELETE" && idMatch) {
    // v1: 删除 = cancelled
    const id = idMatch[1];
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    // 先取上下文: 取消之后 expires/名字都还要用来发通知
    const before = await lessonWithNames(id);
    if (!before) {
      notFound(res, "课次不存在");
      return;
    }
    if (before.status && !["scheduled", "cancelled"].includes(before.status))
      throw new HttpError(409, "LESSON_ALREADY_HANDLED", "已完成考勤的课程不能直接取消");
    if ((await require("../lib/absence.js").get(id))?.state === "pending")
      throw new HttpError(409, "ATTENDANCE_PENDING", "缺席登记结果待确认，不能直接取消课程");
    const rows = await restPatch(
      "lessons",
      { id, ...(before.status ? { status: before.status } : {}) },
      { status: "cancelled" },
    );
    if (!rows?.length) {
      notFound(res, "课次不存在");
      return;
    }
    if (require("../lib/secureStore.js").ready())
      await require("../lib/makeupWorkflow.js").syncLesson({ ...before, status: "cancelled" });
    await audit(req.context.userId, "schedule.cancel", "lesson", id, null, req.reqId);
    // 课都取消了还不告诉家长和老师, 是最容易让人白跑一趟的那种缺口。
    await notifyLessonChanged(req, before, { cancelled: true });
    return ok(res, rows[0]);
  }
  throw new HttpError(405, "METHOD_NOT_ALLOWED", "method not allowed");
};
