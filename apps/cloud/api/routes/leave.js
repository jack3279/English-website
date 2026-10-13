// /leave  请假审批流
// /makeups 补课单
// Worker 走 service_role 绕过 RLS -> 可见性一律走 lib/scoping.js
// 写操作走 lib/rest.js 的 raw PostgREST (supabase-js .update() 在 Workers 里静默 no-op)
const { ok, badRequest, forbidden, notFound, conflict, checkEnumParam } = require("../lib/http.js");
const { requireAuth } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restInsert } = require("../lib/rest.js");
const { visibleStudentIds, canSeeStudent } = require("../lib/scoping.js");
const { record: audit } = require("../lib/audit.js");
const { warn } = require("../lib/log.js");
const wecom = require("../src/wecom.js");
const { z } = require("zod");
const { HttpError } = require("../lib/errors.js");
const { getSettings } = require("../lib/institutionSettings.js");
const { positiveIntParam, nonNegativeIntParam } = require("../lib/pagination.js");

const UUID = /^[0-9a-f-]{36}$/i;

const LEAVE_COLS =
  "id,student_id,lesson_id,requested_by,reason,status,reviewed_by,reviewed_at,review_note,created_at,updated_at";
const MAKEUP_COLS =
  "id,student_id,leave_request_id,original_lesson_id,makeup_lesson_id,scheduled_at,duration_min,status,note,created_by,created_at,updated_at";

const CreateLeave = z.object({
  student_id: z.string().uuid(),
  lesson_id: z.string().uuid().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
});

const ReviewLeave = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional().nullable(),
});

const CreateMakeup = z.object({
  student_id: z.string().uuid().optional().nullable(),
  leave_request_id: z.string().uuid().optional().nullable(),
  original_lesson_id: z.string().uuid().optional().nullable(),
  teacher_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().optional().nullable(),
  duration_min: z.coerce.number().int().min(15).max(240).optional(),
  note: z.string().max(500).optional().nullable(),
});

const PatchMakeup = z.object({
  status: z.enum(["pending", "scheduled", "done", "cancelled"]).optional(),
  scheduled_at: z.string().optional().nullable(),
  duration_min: z.coerce.number().int().min(15).max(240).optional(),
  teacher_id: z.string().uuid().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

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

function validate(res, schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

// 批量补名字, 减少 N+1 查询
async function nameMaps(admin, studentIds, profileIds) {
  const [stu, pro] = await Promise.all([
    studentIds.length
      ? admin.from("students").select("id, full_name").in("id", studentIds)
      : Promise.resolve({ data: [] }),
    profileIds.length
      ? admin.from("profiles").select("id, full_name").in("id", profileIds)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    students: Object.fromEntries((stu.data ?? []).map((r) => [r.id, r.full_name])),
    profiles: Object.fromEntries((pro.data ?? []).map((r) => [r.id, r.full_name])),
  };
}

async function lessonMap(admin, lessonIds) {
  const ids = [...new Set(lessonIds.filter(Boolean))];
  const rows = [];
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await admin
      .from("lessons")
      .select("id, scheduled_at, duration_min, status, teacher_id, student_id")
      .in("id", ids.slice(start, start + 200));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// ---------- 请假 ----------

async function listLeave(req, res) {
  await requireAuth(req, res);
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();
  const limit = positiveIntParam(url.searchParams.get("limit"), 50, 100);
  const status = url.searchParams.get("status");
  const studentId = url.searchParams.get("student_id");

  // leave_requests.status 是 Postgres enum, 非法值会被 PostgREST 打成 500。
  // makeups.status 是 text(不会 500), 但同样按白名单挡掉, 两个列表行为一致。
  if (!checkEnumParam(res, "status", status, ["pending", "approved", "rejected"])) return;

  const ids = await visibleStudentIds(req);
  if (ids && ids.length === 0 && !studentId) {
    ok(res, { items: [], total: 0 });
    return;
  }

  let q = admin.from("leave_requests").select(LEAVE_COLS);
  if (studentId) {
    if (ids && !ids.includes(studentId)) {
      forbidden(res, "该学员不在你的可见范围内");
      return;
    }
    q = q.eq("student_id", studentId);
  } else if (ids) {
    q = q.in("student_id", ids);
  }
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  const names = await nameMaps(
    admin,
    [...new Set(rows.map((r) => r.student_id))],
    [
      ...new Set(
        [...rows.map((r) => r.requested_by), ...rows.map((r) => r.reviewed_by)].filter(Boolean),
      ),
    ],
  );
  const lessons = await lessonMap(admin, [
    ...new Set(rows.map((r) => r.lesson_id).filter(Boolean)),
  ]);

  ok(res, {
    items: rows.map((r) => ({
      ...r,
      student_name: names.students[r.student_id] ?? null,
      requester_name: names.profiles[r.requested_by] ?? null,
      reviewer_name: r.reviewed_by ? (names.profiles[r.reviewed_by] ?? null) : null,
      lesson: r.lesson_id
        ? {
            id: r.lesson_id,
            scheduled_at: lessons[r.lesson_id]?.scheduled_at ?? null,
            duration_min: lessons[r.lesson_id]?.duration_min ?? null,
            status: lessons[r.lesson_id]?.status ?? null,
          }
        : null,
    })),
    total: rows.length,
  });
}

async function createLeave(req, res) {
  const submittedAt = req.__leaveSubmittedAt ??= Date.now();
  await requireAuth(req, res);
  const payload = validate(res, CreateLeave, body(req));
  if (!payload) return;
  if (!(await canSeeStudent(req, payload.student_id))) {
    forbidden(res, "该学员不在你的可见范围内");
    return;
  }
  if (req.context.role === "parent" && !payload.lesson_id) {
    badRequest(res, "请选择需要请假的课程");
    return;
  }
  if (payload.lesson_id && !req.__createLeaveLock && require("../lib/secureStore.js").ready()) {
    return require("../lib/workflowLock.js").withLock(`lesson-${payload.lesson_id}`, async () => {
      req.__createLeaveLock = true;
      try {
        return await createLeave(req, res);
      } finally {
        delete req.__createLeaveLock;
      }
    });
  }
  const admin = getAdmin();
  let lesson = null,
    existing = null;
  let appliedHours = null;
  if (payload.lesson_id) {
    const result = await admin
      .from("lessons")
      .select("id,student_id,teacher_id,scheduled_at,status,leave_status")
      .eq("id", payload.lesson_id)
      .maybeSingle();
    if (result.error) throw new HttpError(503, "LEAVE_UNAVAILABLE", "课程读取失败");
    lesson = result.data;
    if (!lesson) {
      notFound(res, "课节不存在");
      return;
    }
    if (lesson.student_id !== payload.student_id) {
      badRequest(res, "课节与学员不匹配");
      return;
    }
    if (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId) {
      forbidden(res, "只能为自己的课程登记请假");
      return;
    }
    if (lesson.status !== "scheduled") {
      badRequest(res, "只能为待上课课程提交请假申请");
      return;
    }
    if ((await require("../lib/absence.js").get(lesson.id))?.state === "pending")
      throw new HttpError(409, "ATTENDANCE_PENDING", "考勤正在处理，暂不能同时提交请假");
    const dup = await admin
      .from("leave_requests")
      .select(LEAVE_COLS)
      .eq("lesson_id", lesson.id)
      .eq("status", "pending")
      .maybeSingle();
    if (dup.error) throw new HttpError(503, "LEAVE_UNAVAILABLE", "请假记录读取失败");
    existing = dup.data;
    if (!existing) {
      const { leaveDeadlineHours } = await getSettings();
      appliedHours = leaveDeadlineHours;
      if (!require('../lib/leavePolicy.js').onTime(lesson, leaveDeadlineHours, submittedAt))
        throw new HttpError(400, 'LEAVE_DEADLINE', require('../lib/leavePolicy.js').message(leaveDeadlineHours));
    }
  }
  let request = existing;
  if (!request) {
    const draft = {
      id: require("node:crypto").randomUUID(),
      student_id: payload.student_id,
      lesson_id: payload.lesson_id || null,
      requested_by: req.context.userId,
      reason: payload.reason?.trim() || null,
      status: "pending",
      created_at: new Date(submittedAt).toISOString(),
    };
    if (lesson) await require('../lib/leavePolicy.js').remember(draft, lesson, appliedHours, submittedAt);
    const rows = await restInsert("leave_requests", draft);
    if (!rows?.length)
      throw new HttpError(503, "LEAVE_PENDING", "请假单创建未确认，请核对列表后重试");
    request = rows[0];
  }
  if (lesson && lesson.leave_status !== "pending") {
    const rows = await restPatch(
      "lessons",
      { id: lesson.id, status: "scheduled" },
      { leave_status: "pending", leave_reason: request.reason || payload.reason?.trim() || null },
    );
    if (!rows?.length)
      throw new HttpError(
        409,
        "LEAVE_SYNC_PENDING",
        "申请已提交，课程标记尚未同步，请按原内容重试，不会重复创建审批单",
      );
  }
  if (!existing) {
    await audit(
      req.context.userId,
      "leave.create",
      "leave_request",
      request.id,
      { student_id: payload.student_id, lesson_id: payload.lesson_id || null },
      req.reqId,
    );
    try {
      const student = await admin
        .from("students")
        .select("branch_id")
        .eq("id", payload.student_id)
        .maybeSingle();
      let q = admin.from("profiles").select("id").eq("role", "admin");
      if (student.data?.branch_id)
        q = q.or(`branch_id.eq.${student.data.branch_id},branch_id.is.null`);
      const admins = await q;
      if (!admins.error)
        await require("../lib/notify.js").push(
          (admins.data || []).map((a) => ({
            type: "leave",
            target_user: a.id,
            student_id: payload.student_id,
            title: "新的请假申请",
            body: request.reason || "请查看并审批",
            link: "/leave",
          })),
          { source: "leave.create", reqId: req.reqId },
        );
    } catch (e) {
      warn("leave_request_notify_failed", { reqId: req.reqId, err: e.message });
    }
  }
  ok(res, { ...request, alreadySubmitted: !!existing });
}

async function reviewLeave(req, res, id) {
  await requireAuth(req, res);
  if (!["admin", "teacher"].includes(req.context.role)) {
    forbidden(res, "只有 admin/teacher 可以审批请假");
    return;
  }
  const payload = validate(res, ReviewLeave, body(req));
  if (!payload) return;

  const admin = getAdmin();
  const { data: row } = await admin
    .from("leave_requests")
    .select(LEAVE_COLS)
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    notFound(res, "请假申请不存在");
    return;
  }
  if (!(await canSeeStudent(req, row.student_id))) {
    forbidden(res, "该学员不在你的可见范围内");
    return;
  }
  if (row.status !== "pending" && row.status !== payload.status) {
    conflict(
      res,
      "LEAVE_ALREADY_REVIEWED",
      `该申请已${row.status === "approved" ? "批准" : "驳回"}`,
    );
    return;
  }

  let originLesson = null;
  if (row.lesson_id) {
    if (!req.__leaveLessonLock && require("../lib/secureStore.js").ready()) {
      return require("../lib/workflowLock.js").withLock(`lesson-${row.lesson_id}`, async () => {
        req.__leaveLessonLock = true;
        try {
          return await reviewLeave(req, res, id);
        } finally {
          delete req.__leaveLessonLock;
        }
      });
    }
    const result = await admin
      .from("lessons")
      .select("id,student_id,scheduled_at,duration_min,status,teacher_id,leave_status")
      .eq("id", row.lesson_id)
      .maybeSingle();
    if (result.error) throw new HttpError(503, "LEAVE_UNAVAILABLE", "原课节读取失败");
    originLesson = result.data;
    if (!originLesson) {
      notFound(res, "原课节不存在");
      return;
    }
    if (
      req.context.role === "teacher" &&
      originLesson.teacher_id !== req.context.userId
    ) {
      forbidden(res, "只能审批自己课程的请假；未分配教师的课节请联系管理员");
      return;
    }
    if ((await require("../lib/absence.js").get(row.lesson_id))?.state === "pending")
      throw new HttpError(409, "ATTENDANCE_PENDING", "缺席登记尚未完成，不能同时审批请假");
    if (
      payload.status === "approved" &&
      originLesson.status &&
      !(
        originLesson.status === "scheduled" ||
        (originLesson.status === "cancelled" && originLesson.leave_status === "approved")
      )
    ) {
      conflict(res, "LESSON_ALREADY_HANDLED", "原课节已完成考勤，不能再批准请假");
      return;
    }
  }
  const now = new Date().toISOString();
  if (payload.status === 'approved' && row.status === 'pending' && originLesson) {
    const policy = require('../lib/leavePolicy.js');
    const { leaveDeadlineHours } = await getSettings();
    if (!await policy.eligible(row, originLesson, leaveDeadlineHours))
      throw new HttpError(400, 'LEAVE_DEADLINE', policy.message(leaveDeadlineHours));
  }
  const patched = await restPatch(
    "leave_requests",
    { id, status: row.status },
    {
      status: payload.status,
      reviewed_by: req.context.userId,
      reviewed_at: now,
      review_note: payload.note?.trim() || null,
    },
  );

  if (!patched?.length) throw new HttpError(409, "LEAVE_CHANGED", "请假单状态发生变化，请刷新核对");
  // 同步到课节: 批准 -> 该课节标记为请假(取消, 不扣课时); 驳回 -> 记 rejected 但照常上课
  let lessonPatch = null;
  if (row.lesson_id) {
    lessonPatch =
      payload.status === "approved"
        ? { status: "cancelled", leave_status: "approved", leave_reason: row.reason }
        : { leave_status: "rejected", leave_reason: row.reason };
    const changedLesson = await restPatch(
      "lessons",
      { id: row.lesson_id, ...(originLesson?.status ? { status: originLesson.status } : {}) },
      lessonPatch,
    );
    if (!changedLesson?.length)
      throw new HttpError(
        409,
        "LEAVE_SYNC_PENDING",
        "请假已审批，但课节同步未确认，请按原审批结果重试",
      );
    if (require("../lib/secureStore.js").ready())
      await require("../lib/makeupWorkflow.js").syncLesson({ ...originLesson, ...lessonPatch });
  }

  // 批准后自动生成待补课单(去重)
  let makeup = null;
  if (payload.status === "approved") {
    if (require("../lib/secureStore.js").ready() && originLesson) {
      makeup = await require("../lib/makeupWorkflow.js").ensureForLeave(
        req,
        originLesson,
        row.id,
        row.reason,
      );
    } else {
      const { data: exist } = await admin
        .from("makeups")
        .select("id")
        .eq("leave_request_id", row.id)
        .maybeSingle();
      if (!exist) {
        const inserted = await restInsert(
          "makeups",
          {
            student_id: row.student_id,
            leave_request_id: row.id,
            original_lesson_id: row.lesson_id || null,
            duration_min: originLesson?.duration_min ?? 60,
            status: "pending",
            note: row.reason,
            created_by: req.context.userId,
          },
          "return=representation",
        );
        makeup = inserted?.[0] ?? null;
      } else {
        makeup = exist;
      }
    }
    await notifyParents(req, row, payload.status);
  } else {
    await notifyParents(req, row, payload.status);
  }

  await audit(
    req.context.userId,
    `leave.${payload.status}`,
    "leave_request",
    row.id,
    { student_id: row.student_id, lesson_id: row.lesson_id, note: payload.note ?? null },
    req.reqId,
  );

  ok(res, {
    leave: patched?.[0] ?? {
      ...row,
      ...payload,
      reviewed_by: req.context.userId,
      reviewed_at: now,
    },
    lesson: lessonPatch ? { id: row.lesson_id, ...lessonPatch } : null,
    makeup: makeup ? { id: makeup.id, status: makeup.status ?? "pending" } : null,
  });
}

// 审批结果通知家长(尽力而为, 失败不影响审批): 站内通知 + 企业微信
async function notifyParents(req, row, status) {
  try {
    const admin = getAdmin();
    const { data: links } = await admin
      .from("parent_student_links")
      .select("parents(profile_id)")
      .eq("student_id", row.student_id);
    const userIds = [...new Set((links ?? []).map((l) => l.parents?.profile_id).filter(Boolean))];

    // 家长企微外部联系人 ID 存在学员身上 (见 v4 迁移注释)
    const { data: stu } = await admin
      .from("students")
      .select("wecom_external_user_id")
      .eq("id", row.student_id)
      .maybeSingle();
    const wecomId = stu?.wecom_external_user_id || null;

    const title = status === "approved" ? "请假已批准" : "请假被驳回";
    if (userIds.length) {
      await restInsert(
        "notifications",
        userIds.map((uid) => ({
          type: "leave",
          title,
          body: row.reason || null,
          target_user: uid,
          student_id: row.student_id,
          link: `/students/${row.student_id}`,
        })),
        "return=minimal",
      );
    }

    // 企微客户联系消息 (家长): 未配置凭证或未绑定时自动跳过
    if (wecomId) {
      const text =
        status === "approved"
          ? `请假已批准：${row.reason || "（无说明）"}。该课节不扣课时，我们会尽快与您沟通补课时间。`
          : `请假未通过：${row.reason || "（无说明）"}。如有疑问请联系老师。`;
      await wecom.runBatch([wecom.sendExternalMessage(wecomId, text)]);
    }
  } catch (e) {
    // 通知失败不回滚审批, 但要留痕便于排查
    warn("leave_notify_failed", { reqId: req.reqId, student_id: row.student_id, err: e?.message });
  }
}

// ---------- 补课 ----------

async function listMakeups(req, res) {
  await requireAuth(req, res);
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();
  const page = positiveIntParam(url.searchParams.get("page"), 1, 100000);
  const pageSize = positiveIntParam(
    url.searchParams.get("pageSize") || url.searchParams.get("limit"),
    50,
    100,
  );
  const offset = nonNegativeIntParam(
    url.searchParams.get("offset"),
    (page - 1) * pageSize,
    9900,
  );
  const status = url.searchParams.get("status");
  const studentId = url.searchParams.get("student_id");

  if (!checkEnumParam(res, "status", status, ["pending", "scheduled", "done", "cancelled"])) {
    return;
  }

  const ids = await visibleStudentIds(req);
  if (ids && ids.length === 0 && !studentId) {
    ok(res, { items: [], total: 0 });
    return;
  }

  if (studentId && ids && !ids.includes(studentId)) {
    forbidden(res, "该学员不在你的可见范围内");
    return;
  }

  const baseQuery = () => {
    let q = admin.from("makeups").select(MAKEUP_COLS);
    if (studentId) q = q.eq("student_id", studentId);
    else if (ids) q = q.in("student_id", ids);
    if (status === "pending") q = q.eq("status", status);
    return q;
  };

  const candidates = [];
  const batchSize = 500;
  for (let start = 0; start < 10000; start += batchSize) {
    const { data, error } = await baseQuery()
      .order("created_at", { ascending: false })
      .range(start, start + batchSize - 1);
    if (error) throw error;
    candidates.push(...(data ?? []));
    if ((data ?? []).length < batchSize) break;
    if (candidates.length >= 10000)
      throw new HttpError(503, "MAKEUP_RANGE_TOO_LARGE", "补课单范围过大，请增加筛选条件");
  }

  const lessons = await lessonMap(admin, [
    ...new Set(
      [...candidates.map((r) => r.original_lesson_id), ...candidates.map((r) => r.makeup_lesson_id)],
    ),
  ]);
  const effectiveStatus = (row) => {
    const lesson = lessons[row.makeup_lesson_id];
    return lesson?.status === "completed"
      ? "done"
      : ["cancelled", "no_show"].includes(lesson?.status)
        ? "cancelled"
        : row.status;
  };
  const matched = candidates.filter((row) => !status || effectiveStatus(row) === status);
  const rows = matched.slice(offset, offset + pageSize);
  const names = await nameMaps(admin, [...new Set(rows.map((r) => r.student_id))], []);
  const requestMap = new Map(
    await Promise.all(
      rows.map(async (row) => [row.id, await require("../lib/makeupWorkflow.js").requestInfo(row.id)]),
    ),
  );

  ok(res, {
    items: rows.map((r) => ({
      parent_request: requestMap.get(r.id),
      ...r,
      status: effectiveStatus(r),
      student_name: names.students[r.student_id] ?? null,
      original_lesson: r.original_lesson_id
        ? {
            id: r.original_lesson_id,
            scheduled_at: lessons[r.original_lesson_id]?.scheduled_at ?? null,
            teacher_id: lessons[r.original_lesson_id]?.teacher_id ?? null,
          }
        : null,
      makeup_lesson: r.makeup_lesson_id
        ? {
            id: r.makeup_lesson_id,
            scheduled_at: lessons[r.makeup_lesson_id]?.scheduled_at ?? null,
            teacher_id: lessons[r.makeup_lesson_id]?.teacher_id ?? null,
            status: lessons[r.makeup_lesson_id]?.status ?? null,
          }
        : null,
    })),
    total: matched.length,
    page,
    pageSize,
  });
}

async function createMakeup(req, res) {
  await requireAuth(req, res);
  if (!["admin", "teacher", "parent"].includes(req.context.role)) {
    forbidden(res, "无补课申请权限");
    return;
  }
  const payload = validate(res, CreateMakeup, body(req));
  if (!payload) return;
  const result = await require("../lib/makeupWorkflow.js").create(req, payload);
  await audit(
    req.context.userId,
    req.context.role === "parent" ? "makeup.request" : "makeup.create",
    "makeup",
    result.id,
    { student_id: result.student_id },
    req.reqId,
  );
  ok(res, result);
}
async function patchMakeup(req, res, id) {
  await requireAuth(req, res);
  if (!["admin", "teacher"].includes(req.context.role)) {
    forbidden(res, "只有管理员或老师可以安排补课");
    return;
  }
  if (!UUID.test(id)) {
    badRequest(res, "补课编号无效");
    return;
  }
  const payload = validate(res, PatchMakeup, body(req));
  if (!payload) return;
  return require("../lib/workflowLock.js").withLock(`makeup-${id}`, async () => {
    const result = await getAdmin().from("makeups").select("*").eq("id", id).maybeSingle();
    if (result.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "补课单读取失败");
    if (!result.data) {
      notFound(res, "补课单不存在");
      return;
    }
    const updated = await require("../lib/makeupWorkflow.js").schedule(req, result.data, payload);
    await audit(
      req.context.userId,
      "makeup.update",
      "makeup",
      id,
      { status: updated.status, makeup_lesson_id: updated.makeup_lesson_id },
      req.reqId,
    );
    ok(res, updated);
  });
}

// 注意: 入口会把 URL 重写为"去掉路由段"的形式
//   /api/leave/xxx/review  -> req.url = "/xxx/review"
//   /api/makeups/xxx       -> 由 routes/makeups.js 补回 "/makeups" 前缀后转进来
module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);

  if (m[0] === "makeups") {
    if (req.method === "GET") return listMakeups(req, res);
    if (req.method === "POST") return createMakeup(req, res);
    if (req.method === "PATCH" && m[1]) return patchMakeup(req, res, m[1]);
    forbidden(res, "unknown makeups route");
    return;
  }

  // /leave/:id/review  ->  "/:id/review"
  if (m[1] === "review" && req.method === "POST") return reviewLeave(req, res, m[0]);
  if (m.length && UUID.test(m[0]) && req.method !== "GET" && req.method !== "POST") {
    forbidden(res, "unknown leave route");
    return;
  }
  if (req.method === "GET") return listLeave(req, res);
  if (req.method === "POST") return createLeave(req, res);
  forbidden(res, "unknown leave route");
};
