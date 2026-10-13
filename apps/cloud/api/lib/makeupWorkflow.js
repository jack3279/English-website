const { getAdmin } = require("./supabase.js");
const { restInsert, restPatch } = require("./rest.js");
const { HttpError } = require("./errors.js");
const { canSeeStudent } = require("./scoping.js");
const store = require("./secureStore.js");
const { withLock } = require("./workflowLock.js");
const { detect } = require("@cloud/domain");
async function one(table, id) {
  const r = await getAdmin().from(table).select("*").eq("id", id).maybeSingle();
  if (r.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "补课资料读取失败");
  return r.data;
}
async function stableId(value) {
  const h = await store.hash(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function requestInfo(id) {
  return store.ready() ? (await store.read(`private/makeup-requests/${id}`, null)).value : null;
}
function validateTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= Date.now())
    throw new HttpError(400, "MAKEUP_TIME", "请选择未来的有效补课时间");
  return new Date(time).toISOString();
}
async function authorize(req, row, original, current) {
  if (!(await canSeeStudent(req, row.student_id)))
    throw new HttpError(403, "FORBIDDEN", "该学员不在你的可见范围内");
  if (original && original.student_id !== row.student_id)
    throw new HttpError(400, "MAKEUP_STUDENT", "原课节与学生不匹配");
  if (req.context.role === "teacher") {
    const requiredTeacherId = current ? current.teacher_id : original?.teacher_id;
    if (requiredTeacherId !== req.context.userId)
      throw new HttpError(403, "FORBIDDEN", "只能处理自己课程的补课");
  }
}
async function schedule(req, row, input) {
  const original = row.original_lesson_id ? await one("lessons", row.original_lesson_id) : null;
  const current = row.makeup_lesson_id ? await one("lessons", row.makeup_lesson_id) : null;
  await authorize(req, row, original, current);
  if (current && current.student_id !== row.student_id)
    throw new HttpError(409, "MAKEUP_STUDENT", "关联补课课程与学生不匹配，请联系管理员核对");
  if (row.makeup_lesson_id && !current)
    throw new HttpError(409, "MAKEUP_LESSON_MISSING", "关联补课课节不存在，请联系管理员核对");
  if (
    ["done", "cancelled"].includes(row.status) ||
    (current &&
      current.status !== "scheduled" &&
      !(input.status === "cancelled" && current.status === "cancelled"))
  )
    throw new HttpError(409, "MAKEUP_FINISHED", "已处理的补课不能再次改期或取消");
  const nextStatus = input.status || row.status;
  if (nextStatus === "done")
    throw new HttpError(
      400,
      "MAKEUP_COMPLETE_REQUIRED",
      "请从课表完成考勤及课后记录，系统会自动完成补课单",
    );
  const target = { ...row, ...input };
  delete target.teacher_id;
  if (nextStatus === "scheduled") {
    const scheduledAt = validateTime(input.scheduled_at || row.scheduled_at);
    const teacherId = input.teacher_id || current?.teacher_id || original?.teacher_id;
    if (!teacherId) throw new HttpError(400, "MAKEUP_TEACHER", "请选择补课老师");
    if (req.context.role === "teacher" && teacherId !== req.context.userId)
      throw new HttpError(403, "FORBIDDEN", "老师不能将补课分配给其他老师，请联系管理员");
    const teacher = await getAdmin()
      .from("teachers")
      .select("profile_id,active")
      .eq("profile_id", teacherId)
      .maybeSingle();
    if (teacher.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "教师资料读取失败");
    if (!teacher.data || teacher.data.active === false)
      throw new HttpError(400, "MAKEUP_TEACHER", "补课老师不存在或已停用");
    const lessonId = current?.id || (await stableId(`makeup-lesson:${row.id}`));
    const lessonData = {
      student_id: row.student_id,
      teacher_id: teacherId,
      course_id: current?.course_id || original?.course_id || null,
      scheduled_at: scheduledAt,
      duration_min: input.duration_min ?? row.duration_min ?? original?.duration_min ?? 60,
      status: "scheduled",
    };
    const writeLesson = async () => {
      await require("./teacherAvailability.js").assertAvailable(lessonData);
      const nearby = await getAdmin()
        .from("lessons")
        .select("id,teacher_id,student_id,scheduled_at,duration_min,status")
        .neq("id", lessonId)
        .or(`teacher_id.eq.${teacherId},student_id.eq.${row.student_id}`)
        .gte("scheduled_at", new Date(Date.parse(scheduledAt) - 86400000).toISOString())
        .lte("scheduled_at", new Date(Date.parse(scheduledAt) + 86400000).toISOString());
      if (nearby.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "排课冲突检查失败，未排期");
      const conflicts = detect({ newLesson: lessonData, existingLessons: nearby.data || [] });
      if (conflicts.length)
        throw new HttpError(409, "SCHEDULE_CONFLICT", "补课时间与老师或学生的其他课程冲突", {
          conflicts,
        });

      if ((await require("./absence.js").get(lessonId))?.state === "pending")
        throw new HttpError(409, "ATTENDANCE_PENDING", "该课节考勤处理未完成，暂不能改期");
      let existing = current || (await one("lessons", lessonId));
      if (existing && existing.status !== "scheduled")
        throw new HttpError(409, "MAKEUP_FINISHED", "补课已完成考勤，不能重新排期");
      const rows = existing
        ? await restPatch("lessons", { id: lessonId, status: "scheduled" }, lessonData)
        : await restInsert("lessons", { id: lessonId, ...lessonData });
      if (!rows?.length) throw new HttpError(409, "MAKEUP_CHANGED", "课节发生变化，请刷新核对");
      const patched = await restPatch(
        "makeups",
        { id: row.id, status: row.status },
        {
          scheduled_at: scheduledAt,
          duration_min: lessonData.duration_min,
          status: "scheduled",
          makeup_lesson_id: lessonId,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      );
      if (!patched?.length)
        throw new HttpError(
          409,
          "MAKEUP_CHANGED",
          "课节已排期，补课单同步未确认，请保持原参数重试",
        );
      return {
        ...target,
        ...patched[0],
        makeup_lesson_id: lessonId,
        scheduled_at: scheduledAt,
        duration_min: lessonData.duration_min,
        status: "scheduled",
      };
    };
    const result = await require("./teacherAvailability.js").withTeacherLocks([teacherId], () =>
      withLock(`lesson-${lessonId}`, writeLesson),
    );
    await require("./notify.js").pushToParents(
      row.student_id,
      {
        type: "leave",
        title: current ? "补课安排已调整" : "补课已安排",
        body: `补课时间：${new Date(scheduledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}，${lessonData.duration_min}分钟。`,
        link: "/leave?tab=makeup",
      },
      { reqId: req.reqId, source: "makeup.schedule" },
    );
    return result;
  }
  if (current && nextStatus === "pending")
    throw new HttpError(400, "MAKEUP_STATE", "已排期课节不能直接退回待排期，请改期或取消");
  const update = async () => {
    if (current && current.status === "scheduled") {
      const rows = await restPatch(
        "lessons",
        { id: current.id, status: "scheduled" },
        { status: "cancelled" },
      );
      if (!rows?.length) throw new HttpError(409, "MAKEUP_CHANGED", "课程状态变化，请刷新");
    }
    const rows = await restPatch(
      "makeups",
      { id: row.id, status: row.status },
      { status: nextStatus, ...(input.note !== undefined ? { note: input.note } : {}) },
    );
    if (!rows?.length) throw new HttpError(409, "MAKEUP_CHANGED", "补课单更新未确认，请刷新核对");
    return { ...target, ...rows[0], status: nextStatus };
  };
  return current ? withLock(`lesson-${current.id}`, update) : update();
}
async function create(req, input) {
  const parent = req.context.role === "parent";
  if (parent && !input.original_lesson_id)
    throw new HttpError(400, "MAKEUP_ORIGINAL_REQUIRED", "请选择需要补课的原课节");
  if (parent && !store.ready())
    throw new HttpError(503, "MAKEUP_STORAGE", "申请存储暂不可用，未创建补课单");
  if (parent && !input.note?.trim()) throw new HttpError(400, "MAKEUP_NOTE", "请填写补课需求说明");
  if (parent && (input.teacher_id || input.duration_min !== undefined))
    throw new HttpError(403, "FORBIDDEN", "家长只提交补课需求，老师及时长由教务安排");
  const original = input.original_lesson_id ? await one("lessons", input.original_lesson_id) : null;
  if (input.original_lesson_id && !original)
    throw new HttpError(404, "MAKEUP_ORIGINAL_MISSING", "原课节不存在");
  const leave = input.leave_request_id ? await one("leave_requests", input.leave_request_id) : null;
  if (input.leave_request_id && (!leave || leave.status !== "approved"))
    throw new HttpError(400, "MAKEUP_LEAVE", "请假单不存在或尚未批准");
  const studentId = input.student_id || original?.student_id || leave?.student_id;
  if (!studentId) throw new HttpError(400, "MAKEUP_STUDENT", "请选择学生");
  if (leave && (leave.student_id !== studentId || (original && leave.lesson_id !== original.id)))
    throw new HttpError(400, "MAKEUP_STUDENT", "请假单、课程与学生不匹配");
  const origin = original || (leave?.lesson_id ? await one("lessons", leave.lesson_id) : null);
  await authorize(req, { student_id: studentId }, origin);
  if (parent && origin && !["cancelled", "no_show"].includes(origin.status))
    throw new HttpError(
      400,
      "MAKEUP_ORIGINAL_STATE",
      "只能为已取消或缺席的课程申请补课；未上课程请先申请请假",
    );
  const time = input.scheduled_at ? validateTime(input.scheduled_at) : null;
  return withLock(`makeup-create-${origin?.id || studentId}`, async () => {
    let row = null;
    if (origin) {
      const found = await getAdmin()
        .from("makeups")
        .select("*")
        .eq("original_lesson_id", origin.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (found.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "已有补课单读取失败");
      row = found.data;
    }
    if (row && ["done", "cancelled"].includes(row.status))
      throw new HttpError(
        409,
        "MAKEUP_EXISTS",
        "该课节已有已处理的补课单，请联系教务核对，不能重复申请",
      );
    if (!row) {
      const id = origin
        ? await stableId(`makeup:${origin.id}`)
        : require("node:crypto").randomUUID();
      const rows = await restInsert("makeups", {
        id,
        student_id: studentId,
        original_lesson_id: origin?.id || null,
        leave_request_id: leave?.id || input.leave_request_id || null,
        status: "pending",
        duration_min: input.duration_min ?? origin?.duration_min ?? 60,
        note: input.note?.trim() || null,
        created_by: req.context.userId,
      });
      if (!rows?.length)
        throw new HttpError(503, "MAKEUP_CREATE_PENDING", "补课单创建未确认，请核对列表后重试");
      row = {
        id,
        student_id: studentId,
        original_lesson_id: origin?.id || null,
        duration_min: origin?.duration_min ?? 60,
        status: "pending",
        ...rows[0],
      };
    }
    if (parent) {
      if (row.status === "scheduled")
        throw new HttpError(
          409,
          "MAKEUP_ALREADY_SCHEDULED",
          "该课节已安排补课，请查看课表；需要改期请联系教务",
        );
      if (!store.ready())
        throw new HttpError(503, "MAKEUP_STORAGE", "补课申请存储暂不可用，请稍后重试");
      const info = {
        preferred_at: time,
        request_note: input.note?.trim() || "",
        requested_by: req.context.userId,
        requested_at: new Date().toISOString(),
      };
      const previous = await requestInfo(row.id);
      if (
        previous?.preferred_at === info.preferred_at &&
        previous?.request_note === info.request_note &&
        previous?.requested_by === info.requested_by
      )
        return { ...row, parent_request: previous, alreadyRequested: true };
      await store.change(`private/makeup-requests/${row.id}`, null, () => info);
      const student = await one("students", studentId);
      let adminQuery = getAdmin().from("profiles").select("id").eq("role", "admin");
      if (student?.branch_id)
        adminQuery = adminQuery.or(`branch_id.eq.${student.branch_id},branch_id.is.null`);
      const admins = await adminQuery;
      if (!admins.error)
        await require("./notify.js").push(
          (admins.data || []).map((a) => ({
            type: "leave",
            target_user: a.id,
            student_id: studentId,
            title: "家长提交补课需求",
            body: info.request_note || "请查看希望补课时间并安排",
            link: "/leave?tab=makeup",
          })),
          { source: "makeup.request", reqId: req.reqId },
        );
      return { ...row, parent_request: info };
    }
    return time
      ? withLock(`makeup-${row.id}`, () =>
          schedule(req, row, { ...input, status: "scheduled", scheduled_at: time }),
        )
      : row;
  });
}
async function syncLesson(lesson) {
  const r = await getAdmin()
    .from("makeups")
    .select("id,status,scheduled_at,duration_min")
    .eq("makeup_lesson_id", lesson.id);
  if (r.error)
    throw new HttpError(
      503,
      "MAKEUP_SYNC_PENDING",
      "考勤已记录，但补课单同步失败，请重试或刷新核对",
    );
  for (const row of r.data || []) {
    const status =
      lesson.status === "completed"
        ? "done"
        : ["cancelled", "no_show"].includes(lesson.status)
          ? "cancelled"
          : "scheduled";
    const rows = await restPatch(
      "makeups",
      { id: row.id },
      {
        status,
        scheduled_at: lesson.scheduled_at || row.scheduled_at,
        duration_min: lesson.duration_min || row.duration_min,
      },
    );
    if (!rows?.length)
      throw new HttpError(409, "MAKEUP_SYNC_PENDING", "补课单同步未确认，请刷新核对");
  }
}
async function ensureForLeave(req, lesson, leaveId, note) {
  return withLock(`makeup-create-${lesson.id}`, async () => {
    const found = await getAdmin()
      .from("makeups")
      .select("id,status")
      .eq("original_lesson_id", lesson.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (found.error) throw new HttpError(503, "MAKEUP_UNAVAILABLE", "补课单读取失败");
    if (found.data) return found.data;
    const rows = await restInsert("makeups", {
      id: await stableId(`makeup:${lesson.id}`),
      student_id: lesson.student_id,
      original_lesson_id: lesson.id,
      leave_request_id: leaveId,
      duration_min: lesson.duration_min ?? 60,
      status: "pending",
      note: note || null,
      created_by: req.context.userId,
    });
    if (!rows?.length)
      throw new HttpError(503, "MAKEUP_CREATE_PENDING", "请假已处理，补课单创建未确认，请重试核对");
    return rows[0];
  });
}
module.exports = { create, schedule, requestInfo, syncLesson, ensureForLeave };
