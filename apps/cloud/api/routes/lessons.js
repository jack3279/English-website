const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, forbidden, notFound, unprocessable, conflict, badRequest } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const { CompleteLessonInput } = require("@cloud/schema");
const {
  compute,
  detect,
  LessonNotFoundError,
  StudentNotFoundError,
  LessonAlreadyCompletedError,
  LessonNotOwnedError,
  InsufficientHoursError,
} = require("@cloud/domain");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restDelete, restInsert } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");
const notify = require("../lib/notify.js");
const { notifyLessonChanged } = require("../lib/lessonChanged.js");
const wecom = require("../src/wecom.js");
const { warn, info } = require("../lib/log.js");

// 回滚用的尽力而为删除: 失败只告警, 不掩盖原始错误
async function safeDelete(table, filter) {
  try {
    await restDelete(table, filter);
  } catch (e) {
    warn("rollback_delete_failed", { table, err: e.message });
  }
}

// 直连 PostgREST 的**只读**取数。用它而不用 supabase-js 的原因写在调用处:
// supabase-js 在 Workers 上偶发「0 rows / 静默失败」。
// 写操作一律走 lib/rest.js, 不要用这个函数 —— 早先它挂着
// `resolution=merge-duplicates` 的 Prefer 头(那是给 upsert 用的),
// 而实际调用点全是 GET, 属于会误导下一个人的假信号。
async function fetchRaw(table, method, body, query = "") {
  const env = globalThis.__CLOUDFLARE_ENV || process.env;
  const scoped=require('../lib/dataScope.js').queryString(table,query.replace(/^\?/,''));
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${scoped?'?'+scoped:''}`;
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(body ? { Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`raw ${table} ${method} failed: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// 简单 helper: 按 profile_id 查老师姓名 (用于课堂反馈文案)。
// 走 supabase-js, 单条 maybeSingle 失败兜底 null, 不抛错。
async function fetchTeacherName(admin, profileId) {
  if (!profileId) return null;
  try {
    const { data } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", profileId)
      .maybeSingle();
    return data?.full_name ?? null;
  } catch (_) {
    return null;
  }
}

// 老师发布了课堂反馈 -> 通知家长。
// notifications 里 "class_report" 这个类型一直被前端标成「课堂反馈」, 但从来没有代码产生它,
// 家长只能自己点进家长端才看得到反馈; 这里把缺口补上。
// 同时走 站内 notifications + 企业微信外部消息 —— 任一失败都不影响主流程,
// 也不影响另一通道 (见 lib/notify.js pushBoth)。
async function notifyParentsOfReport(req, studentId, studentName, teacherName, summary, lessonCtx) {
  const ctx = { reqId: req.reqId, source: "lessons.complete", studentId };
  await notify.pushBoth(
    studentId,
    {
      type: "class_report",
      title: `${studentName} 的${lessonCtx?.attendanceOnly ? "上课记录" : "课堂反馈"}`,
      body: summary || null,
      link: "/parent",
    },
    // WeCom: 把课堂反馈发到家长企业微信
    (extId) =>
      wecom.classReportJobs({
        parentWecomIds: [extId],
        payload: {
          studentName,
          teacherName,
          scheduledAt: lessonCtx?.scheduledAt,
          durationMin: lessonCtx?.durationMin,
          summary,
        },
      }),
    ctx,
  );
}

async function complete(req, res, lessonId) {
  if (!req.__lessonLock && require("../lib/secureStore.js").ready()) {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");
    return require("../lib/workflowLock.js").withLock(`lesson-${lessonId}`, async () => {
      req.__lessonLock = true;
      try {
        return await complete(req, res, lessonId);
      } finally {
        delete req.__lessonLock;
      }
    });
  }
  await requireAuth(req, res);
  requireRole(req, res, "admin", "teacher");

  const parsed = CompleteLessonInput.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const input = parsed.data;

  const admin = getAdmin();

  // 1. 拉 lesson (用 raw PostgREST fetch 绕开 supabase-js .single() 在 workers 偶发返 0 rows 问题)
  const rows = await fetchRaw("lessons", "GET", null, `?id=eq.${lessonId}&select=*`);
  const lesson = Array.isArray(rows) ? rows[0] : null;
  if (!lesson) {
    notFound(res, "课次不存在");
    return;
  }

  if (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId) {
    forbidden(res, "只能完成自己的课次");
    return;
  }
  if (lesson.leave_status === "pending")
    throw new HttpError(409, "LEAVE_PENDING", "请先审批该课程的请假申请，再登记完课");
  const attendanceState = await require("../lib/absence.js").get(lessonId);
  if (attendanceState?.state === "pending")
    throw new HttpError(
      409,
      "ATTENDANCE_PENDING",
      "该课节缺席登记尚未完成，请先按原选择完成缺席登记，不能再次消课",
    );
  if (!req.__studentLock && require("../lib/secureStore.js").ready()) {
    return require("../lib/workflowLock.js").withLock(`student-${lesson.student_id}`, async () => {
      req.__studentLock = true;
      try {
        return await complete(req, res, lessonId);
      } finally {
        delete req.__studentLock;
      }
    });
  }
  // 1.5 如果 lesson.status='completed' OR records 已存在, 幂等返
  const { data: existingRec } = await admin
    .from("records")
    .select("id")
    .eq("lesson_id", lessonId)
    .maybeSingle();
  if (lesson.status === "completed" || (existingRec && lesson.status === "scheduled")) {
    // 幂等命中是正常路径(前端重复点、网络重试都会走到这), 用 info 而不是裸 console.log,
    // 这样能带上 reqId 与 lessonId, 与响应头对得上。
    info("complete_idempotent", {
      reqId: req.reqId,
      lessonId,
      status: lesson.status,
      hasRecord: !!existingRec,
    });
    if (lesson.status === "scheduled" && existingRec && require("../lib/secureStore.js").ready()) {
      const consumed = await admin
        .from("lesson_transactions")
        .select("id,delta")
        .eq("lesson_id", lessonId)
        .eq("reason", "consume")
        .maybeSingle();
      if (consumed.error || !consumed.data || !Number.isFinite(Number(consumed.data.delta)))
        throw new HttpError(
          409,
          "COMPLETION_PENDING",
          "已有课堂记录但扣课结果未确认，请联系教务核对课时账单；未重复扣课",
        );
    }
    // 兜底: 如果 records 存在但 status 还 scheduled (上次失败残留), 修复状态
    if (lesson.status !== "completed" && existingRec) {
      try {
        const repaired = await restPatch(
          "lessons",
          { id: lessonId, status: "scheduled" },
          {
            status: "completed",
            completed_at: new Date().toISOString(),
          },
        );
        if (!repaired?.length)
          throw new HttpError(409, "COMPLETION_PENDING", "课节状态同步未确认，请刷新核对");
      } catch (e) {
        warn("lesson_status_repair_failed", { reqId: req.reqId, err: e.message });
        throw e;
      }
    }
    if (require("../lib/secureStore.js").ready())
      await require("../lib/makeupWorkflow.js").syncLesson({ ...lesson, status: "completed" });
    ok(res, {
      lessonId,
      recordId: existingRec?.id ?? null,
      newBalance: null,
      parentFeedPublished: false,
      alreadyCompleted: true,
    });
    return;
  }

  // 2. 权限：admin 全开；teacher 仅自己
  if (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId) {
    forbidden(res, "只能完成自己的课次");
    return;
  }

  // 3. 拉 student
  const { data: student } = await admin
    .from("students")
    .select("id, full_name")
    .eq("id", lesson.student_id)
    .single();
  if (!student) {
    notFound(res, "学员不存在");
    return;
  }

  // 4. 拉余额
  const { data: bal, error: balanceError } = await admin
    .from("student_balance")
    .select("remaining_hours")
    .eq("student_id", student.id)
    .maybeSingle();
  if (balanceError) throw new HttpError(503, "BALANCE_UNAVAILABLE", "课时余额读取失败，未扣课时");
  const currentBalance = Number(bal?.remaining_hours ?? 0);

  // 4.5 老师课酬单价 —— 消课时要把单价冻结成课节快照
  const teacherId = req.context.role === "admin" ? lesson.teacher_id : req.context.userId;
  const teacherRows = await fetchRaw(
    "teachers",
    "GET",
    null,
    `?profile_id=eq.${teacherId}&select=hourly_pay,pay_currency,profile_id`,
  );
  const teacherRow = (Array.isArray(teacherRows) ? teacherRows[0] : null) || {};
  const pricing = require("../lib/payrollPricing.js");
  const pricingReady = require("../lib/secureStore.js").ready();
  let frozenPrice = null;
  let hourlyPay = Number(teacherRow.hourly_pay ?? 0);

  // 5. 调 domain compute
  let plan;
  try {
    plan = compute({
      lesson,
      student,
      teacher: { id: teacherId, hourlyPay },
      currentBalance,
      record: input,
      publishToParent: input.publishToParent,
    });
  } catch (e) {
    if (e instanceof InsufficientHoursError) {
      unprocessable(res, e.code, e.message, e.details);
      return;
    }
    if (e instanceof LessonAlreadyCompletedError) {
      conflict(res, e.code, e.message, e.details);
      return;
    }
    if (e instanceof LessonNotOwnedError) {
      forbidden(res);
      return;
    }
    if (e instanceof StudentNotFoundError) {
      notFound(res);
      return;
    }
    if (e instanceof LessonNotFoundError) {
      notFound(res);
      return;
    }
    throw e;
  }

  if (pricingReady) {
    frozenPrice = await pricing.snapshot(lesson, teacherRow);
    plan.lessonUpdate.pay_rate = frozenPrice.hourly_pay;
    plan.lessonUpdate.pay_amount = frozenPrice.amount;
  }

  // 6. 写入（顺序, 失败回滚）
  const { data: rec, error: rErr } = await admin
    .from("records")
    .insert({
      ...plan.record,
      created_by: req.context.userId,
    })
    .select()
    .single();
  if (rErr) throw rErr;

  plan.lessonTransaction.id = require("node:crypto").randomUUID();
  const { error: tErr } = await admin.from("lesson_transactions").insert({
    ...plan.lessonTransaction,
    created_by: req.context.userId,
  });
  if (tErr) {
    await safeDelete("records", { id: rec.id });
    throw tErr;
  }

  try {
    const completedRows = await restPatch(
      "lessons",
      { id: lessonId, status: "scheduled" },
      plan.lessonUpdate,
    );
    if (!completedRows?.length)
      throw new HttpError(409, "LESSON_CHANGED", "课节状态已变化，未重复消课");
  } catch (uErr) {
    await safeDelete("lesson_transactions", { id: plan.lessonTransaction.id ?? "" });
    await safeDelete("records", { id: rec.id });
    throw uErr;
  }

  let parentFeedPublished = false;
  if (plan.parentFeed) {
    plan.parentFeed.record_id = rec.id;
    const { data: publishedFeed, error: fErr } = await admin
      .from("parent_feeds")
      .insert(plan.parentFeed)
      .select("id")
      .maybeSingle();
    if (fErr || !publishedFeed) {
      warn("parent_feed_insert_failed", {
        reqId: req.reqId,
        err: fErr?.message || "missing inserted feed",
      });
    } else {
      parentFeedPublished = true;
      await notifyParentsOfReport(
        req,
        lesson.student_id,
        student.full_name,
        // 老师姓名: teachers 表按 teacher_id (profile_id) 查
        (await fetchTeacherName(admin, teacherId)) ?? "",
        plan.parentFeed.summary,
        {
          scheduledAt: lesson.scheduled_at,
          durationMin: lesson.duration_min,
          attendanceOnly: req.body?.attendanceOnly === true,
        },
      );
    }
  }

  await audit(
    req.context.userId,
    "lesson.complete",
    "lesson",
    lessonId,
    {
      recordId: rec.id,
      delta: plan.lessonTransaction.delta,
      newBalance: plan.newBalance,
    },
    req.reqId,
  );

  if (require("../lib/secureStore.js").ready())
    await require("../lib/makeupWorkflow.js").syncLesson({ ...lesson, ...plan.lessonUpdate });
  ok(res, {
    lessonId,
    recordId: rec.id,
    newBalance: plan.newBalance,
    parentFeedPublished,
  });
}

async function reschedule(req, res, id) {
  if (!req.__rescheduleLock && require("../lib/secureStore.js").ready()) {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");
    return require("../lib/workflowLock.js").withLock(`lesson-${id}`, async () => {
      req.__rescheduleLock = true;
      try {
        return await reschedule(req, res, id);
      } finally {
        delete req.__rescheduleLock;
      }
    });
  }
  await requireAuth(req, res);
  requireRole(req, res, "admin", "teacher");

  const body = typeof req.body === "string" ? safeBody(req) : req.body || {};

  if (body.scheduled_at !== undefined) {
    const newTime = new Date(body.scheduled_at);
    if (Number.isNaN(newTime.getTime())) {
      return badRequest(res, "scheduled_at 格式错误");
    }

    // 一次查出课节与权限所需字段（teacher 归属判定 + 冲突判定 + 通知所需关系）
    const { data: cur, error: currentError } = await getAdmin()
      .from("lessons")
      .select(
        "id, teacher_id, student_id, duration_min, status, scheduled_at, students:student_id (full_name), profiles:teacher_id (full_name)",
      )
      .eq("id", id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!cur) return notFound(res, "课次不存在");

    // teacher 只能改自己的课
    if (req.context.role === "teacher" && cur.teacher_id !== req.context.userId) {
      return forbidden(res, "只能改自己的课");
    }
    if (cur.status !== "scheduled") {
      return conflict(res, "LESSON_NOT_SCHEDULED", "只能改未上完的课节");
    }

    if ((await require("../lib/absence.js").get(id))?.state === "pending")
      throw new HttpError(409, "ATTENDANCE_PENDING", "该课节考勤正在处理，暂不能改期");
    const nextLesson = { ...cur, scheduled_at: body.scheduled_at };

    // 冲突判定复用 domain 的 detect()，与 routes/schedules.js 同一口径。
    // 曾在这里手写 ±60 分钟窗口，导致两处不一致：
    //   误报 —— 不跳过 cancelled/no_show，一节已取消的课会让老师永远拖不动这节课；
    //   漏报 —— 固定 60 分钟忽略 duration_min，120 分钟的课重叠查不出来。
    // detect() 用 scheduled_at + duration_min 算真实重叠区间，两者都覆盖。
    const fromIso = new Date(newTime.getTime() - 24 * 60 * 60_000).toISOString();
    const toIso = new Date(newTime.getTime() + 24 * 60 * 60_000).toISOString();
    const { data: nearby, error: conflictError } = await getAdmin()
      .from("lessons")
      .select("id, teacher_id, student_id, duration_min, status, scheduled_at")
      .neq("id", id)
      .or(`teacher_id.eq.${cur.teacher_id},student_id.eq.${cur.student_id}`)
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso);
    if (conflictError) throw conflictError;
    if (require("../lib/secureStore.js").ready() && !req.__teacherCalendarLock)
      return require("../lib/teacherAvailability.js").withTeacherLocks(
        [cur.teacher_id],
        async () => {
          req.__teacherCalendarLock = true;
          try {
            return await reschedule(req, res, id);
          } finally {
            delete req.__teacherCalendarLock;
          }
        },
      );
    await require("../lib/teacherAvailability.js").assertAvailable({
      ...cur,
      scheduled_at: body.scheduled_at,
      duration_min: body.duration_min ?? cur.duration_min,
    });
    const conflicts = detect({ newLesson: nextLesson, existingLessons: nearby || [] });
    if (conflicts.length > 0) {
      return conflict(res, "SCHEDULE_CONFLICT", "该时段已有冲突课程", { conflicts });
    }

    const rows = await restPatch(
      "lessons",
      { id, status: "scheduled" },
      { scheduled_at: body.scheduled_at },
    );
    // PostgREST PATCH 打不存在的行照样 200 → 必须校验行数，否则是「假成功」
    if (!rows?.length) return notFound(res, "课次不存在或已被删除");

    if (require("../lib/secureStore.js").ready())
      await require("../lib/makeupWorkflow.js").syncLesson({
        ...cur,
        ...rows[0],
        scheduled_at: body.scheduled_at,
      });
    // 通知家长与老师（复用 schedules.js 的唯一实现）。
    // 曾缺这一步 → 同一个「改期」动作，管理员改会通知、老师拖拽改期不通知。
    try {
      await notifyLessonChanged(
        req,
        { ...cur, ...rows[0], scheduled_at: body.scheduled_at },
        {
          previousAt: cur.scheduled_at,
        },
      );
    } catch (e) {
      warn("lesson_reschedule_notify_failed", { reqId: req.reqId, err: e?.message });
    }

    await audit(
      req.context.userId,
      "lesson.reschedule",
      "lesson",
      id,
      { from: cur.scheduled_at, to: body.scheduled_at },
      req.reqId,
    );

    ok(res, rows[0]);
    return;
  }

  return badRequest(res, "暂只支持改 scheduled_at (拖拽改时间)");
}

async function getOne(req, res, lessonId) {
  await requireAuth(req, res);
  const admin = getAdmin();
  const { data: lesson, error } = await admin
    .from("lessons")
    .select(
      "*, students:student_id(id,full_name), profiles:teacher_id(id,full_name), course:course_id(name)",
    )
    .eq("id", lessonId)
    .single();
  if (error || !lesson) {
    notFound(res);
    return;
  }

  if (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId) {
    forbidden(res);
    return;
  }
  if (req.context.role === "parent") {
    const { data: link } = await admin
      .from("parent_student_links")
      .select("parent_id, parents!inner(profile_id)")
      .eq("student_id", lesson.student_id)
      .eq("parents.profile_id", req.context.userId)
      .maybeSingle();
    if (!link) {
      notFound(res);
      return;
    }
  }

  const { data: record } = await admin
    .from("records")
    .select("*")
    .eq("lesson_id", lessonId)
    .maybeSingle();

  // 是否对家长发布（存在 parent_feed）。家长只能看到已发布反馈，草稿不泄露。
  let published = false;
  if (record) {
    const { data: feed } = await admin
      .from("parent_feeds")
      .select("id")
      .eq("record_id", record.id)
      .maybeSingle();
    published = !!feed;
  }

  let attendance = await require("../lib/absence.js").get(lessonId);
  const correctedAttendance=require('../lib/secureStore.js').ready()?(await require('../lib/secureStore.js').read(`private/attendance-correction/${lessonId}`,null)).value:null;
  if(correctedAttendance)attendance=correctedAttendance.status==='no_show'?{state:'done',choice:correctedAttendance.choice,result:correctedAttendance.result}:null;
  if(req.context.role==='parent'&&attendance)attendance={...attendance,result:{status:attendance.result?.status,deduct_hours:attendance.result?.deduct_hours,deducted_hours:attendance.result?.deducted_hours}};
  const correction=["admin","teacher"].includes(req.context.role)?await require("../lib/lessonCorrections.js").get(lessonId):null;
  const rollCall =
    req.context.role !== "parent" && require("../lib/secureStore.js").ready()
      ? (await require("../lib/secureStore.js").read(`private/roll-call/${lessonId}`, null)).value
      : null;
  if (req.context.role === "parent") {
    delete lesson.pay_rate;
    delete lesson.pay_amount;
    delete lesson.history_note;
    delete lesson.absence_pay_teacher;
    delete lesson.absence_reviewed_by;
  }
  ok(res, {
    ...lesson,
    record: req.context.role === "parent" && !published ? null : (record ?? null),
    roll_call: rollCall ? { state: rollCall.state, input: rollCall.input } : null,
    published,
    correction:correction?{state:correction.state,...(correction.state==='pending'&&(req.context.role==='admin'||correction.actor===req.context.userId&&correction.input.mode==='content')?{input:correction.input}:{}),hour_change:req.context.role==='admin'?correction.plan.hour_change:undefined}:null,
    attendance: attendance
      ? { state: attendance.state, choice: attendance.choice, result: attendance.result }
      : null,
  });
}

// 解析请求体。src/worker.js 在 JSON.parse 失败时会把原始字符串塞回 req.body，
// 所以这个 string 分支是真实可达路径 —— 裸 JSON.parse 会抛 SyntaxError 变 500。
// 这里兜住并返回 {}，让 zod 报「参数不合法」400。
function safeBody(req) {
  try {
    const v = JSON.parse(req.body || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// 点名：老师/教务对一节待上课判定 请假 / 缺席（到课走 /complete）。
//
// ⚠️ 请假分支必须与 routes/leave.js 的 reviewLeave 保持同一终态语义（5 件事）：
//   写 leave_requests → PATCH lessons → 生成补课单 → 通知家长 → audit
// 曾只做 2+5，缺「补课单」与「通知家长」→ 家长不知情、课时凭空蒸发且无人安排补课。
// 写入顺序必须是「先 leave_requests 再 lessons」：反过来若第二步失败，
// 课节已是 cancelled+approved 却无请假单，无法回滚（不可逆的不一致）。
const AttendanceInput = z.object({
  deduct_hours: z.boolean().optional(),
  pay_teacher:z.boolean().optional(),
  review_required:z.boolean().optional(),
  result: z.enum(["leave", "no_show"]),
  reason: z.string().max(500).optional(),
});

// 通知请假/缺席结果给家长（站内 + 企微）。尽力而为，失败只告警不回滚业务。
async function notifyAttendance(req, { studentId, title, body }) {
  try {
    const admin = getAdmin();
    const { data: links } = await admin
      .from("parent_student_links")
      .select("parents(profile_id)")
      .eq("student_id", studentId);
    const userIds = [...new Set((links ?? []).map((l) => l.parents?.profile_id).filter(Boolean))];

    const { data: stu } = await admin
      .from("students")
      .select("wecom_external_user_id")
      .eq("id", studentId)
      .maybeSingle();
    const wecomId = stu?.wecom_external_user_id || null;

    if (userIds.length) {
      await restInsert(
        "notifications",
        userIds.map((uid) => ({
          type: "leave",
          title,
          body: body || null,
          target_user: uid,
          student_id: studentId,
          link: `/students/${studentId}`,
        })),
        "return=minimal",
      );
    }

    // 企微客户联系消息（家长）：未配置凭证或未绑定时自动跳过
    if (wecomId) {
      await wecom.runBatch([wecom.sendExternalMessage(wecomId, `${title}：${body || ""}`)]);
    }
  } catch (e) {
    warn("attendance_notify_failed", {
      reqId: req.reqId,
      student_id: studentId,
      err: e?.message,
    });
  }
}

async function attendance(req, res, lessonId) {
  if (!req.__lessonLock && require("../lib/secureStore.js").ready()) {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");
    return require("../lib/workflowLock.js").withLock(`lesson-${lessonId}`, async () => {
      req.__lessonLock = true;
      try {
        return await attendance(req, res, lessonId);
      } finally {
        delete req.__lessonLock;
      }
    });
  }
  await requireAuth(req, res);
  const { userId, role } = req.context;
  if (role === "parent") {
    forbidden(res, "家长不能点名");
    return;
  }
  if (!["admin", "teacher"].includes(role)) {
    forbidden(res, "无点名权限");
    return;
  }

  const parsed = AttendanceInput.safeParse(
    typeof req.body === "string" ? safeBody(req) : req.body || {},
  );
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const { result, reason } = parsed.data;
  if (result === "leave" && !reason?.trim()) {
    badRequest(res, "请假时必须填写请假原因");
    return;
  }

  const admin = getAdmin();
  const { data: lesson } = await admin
    .from("lessons")
    .select(
      "id, student_id, teacher_id, status, duration_min, scheduled_at, course_id, leave_status",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) {
    notFound(res, "课节不存在");
    return;
  }
  const priorAttendance = await require("../lib/absence.js").get(lessonId);
  if (
    lesson.status !== "scheduled" &&
    !(result === "no_show" && lesson.status === "no_show" && priorAttendance)
  ) {
    conflict(res, "ATTENDANCE_DONE", "该课节已点名，不能重复操作");
    return;
  }
  if (role === "teacher" && lesson.teacher_id !== userId) {
    forbidden(res, "只能给自己的课点名");
    return;
  }

  if (priorAttendance && result === "leave")
    throw new HttpError(
      409,
      "ATTENDANCE_CHANGED",
      "已有缺席处理记录，不能改为请假，请先联系管理员核对",
    );
  if (result === "no_show" && lesson.leave_status === "pending") {
    conflict(res, "LEAVE_PENDING", "请先审批请假申请，再判断是否缺席");
    return;
  }
  if (result === "no_show" && lesson.scheduled_at && Date.parse(lesson.scheduled_at)+Number(lesson.duration_min)*60000 > Date.now()) {
    badRequest(res, "课程尚未结束，不能提前登记缺勤");
    return;
  }
  if (result === "leave") {
    const text = reason.trim();
    const now = new Date().toISOString();

    // ① 先写/更新 leave_requests（拿到 leave_request_id，补课单要引用）
    const { data: pending } = await admin
      .from("leave_requests")
      .select("id,created_at,status")
      .eq("lesson_id", lessonId)
      .eq("status", "pending")
      .maybeSingle();
    const { leaveDeadlineHours } = await require('../lib/institutionSettings.js').getSettings();
    const policy = require('../lib/leavePolicy.js');
    if (!(pending ? await policy.eligible(pending, lesson, leaveDeadlineHours) : policy.onTime(lesson, leaveDeadlineHours)))
      throw new HttpError(400, 'LEAVE_DEADLINE', policy.message(leaveDeadlineHours));

    let leaveRequestId = pending?.id ?? null;
    if (pending) {
      const rows = await restPatch(
        "leave_requests",
        { id: pending.id },
        { status: "approved", reviewed_by: userId, reviewed_at: now },
      );
      if (!rows?.length) throw new HttpError(409, "LEAVE_UPDATE_FAILED", "请假单更新失败");
    } else {
      const inserted = await restInsert("leave_requests", {
        student_id: lesson.student_id,
        lesson_id: lessonId,
        requested_by: userId,
        reason: text,
        status: "approved",
        reviewed_by: userId,
        reviewed_at: now,
      });
      if (!inserted?.length) throw new HttpError(409, "LEAVE_CREATE_FAILED", "请假单创建失败");
      leaveRequestId = inserted[0].id;
    }

    // ② 再改课节终态：cancelled + approved（不扣课时、不进出勤分母）
    //    不用 return=minimal —— 该模式 PostgREST 返回空 body、restPatch 恒为 []，
    //    无法校验是否真改到行，会把「0 行更新」当成成功（假成功）。
    const lessonRows = await restPatch(
      "lessons",
      { id: lessonId },
      { status: "cancelled", leave_status: "approved", leave_reason: text },
    );
    if (!lessonRows?.length) {
      throw new HttpError(404, "LESSON_UPDATE_FAILED", "课节状态更新失败");
    }

    // ③ 自动生成待补课单（去重）—— 缺这一步课时就凭空少了且无人安排补课
    let makeup = null;
    if (require("../lib/secureStore.js").ready()) {
      makeup = await require("../lib/makeupWorkflow.js").ensureForLeave(
        req,
        lesson,
        leaveRequestId,
        text,
      );
    } else {
      const { data: exist } = await admin
        .from("makeups")
        .select("id")
        .eq("leave_request_id", leaveRequestId)
        .maybeSingle();
      if (exist) {
        makeup = exist;
      } else {
        const inserted = await restInsert("makeups", {
          student_id: lesson.student_id,
          leave_request_id: leaveRequestId,
          original_lesson_id: lessonId,
          duration_min: lesson.duration_min ?? 60,
          status: "pending",
          note: text,
          created_by: userId,
        });
        makeup = inserted?.[0] ?? null;
      }
    }
    // ④ 通知家长 —— 缺这一步家长完全不知情
    await notifyAttendance(req, {
      studentId: lesson.student_id,
      title: "请假已登记",
      body: `${text}。该课节不扣课时，我们会尽快与您沟通补课时间。`,
    });

    await audit(
      userId,
      "lesson.attendance",
      "lesson",
      lessonId,
      { result, reason: text, leave_request_id: leaveRequestId, makeup_id: makeup?.id ?? null },
      req.reqId,
    );
    ok(res, {
      status: "cancelled",
      leave_status: "approved",
      leave_request_id: leaveRequestId,
      makeup: makeup ? { id: makeup.id, status: makeup.status ?? "pending" } : null,
    });
    return;
  }

  const settings=await require('../lib/institutionSettings.js').getSettings();
  const reviewRequired=priorAttendance?priorAttendance.choice?.review_required:role==='teacher'||req.__lateLeave===true;
  const deduct=reviewRequired?false:priorAttendance?.choice?.deduct_hours??(parsed.data.deduct_hours??settings.absenceDeductHours);
  const payTeacher=reviewRequired?false:priorAttendance?priorAttendance.choice?.pay_teacher:parsed.data.pay_teacher??settings.absencePayTeacher;
  if (deduct && !reason?.trim()) {
    badRequest(res, "缺席扣课时须填写原因");
    return;
  }
  if(!require('../lib/secureStore.js').ready())throw new HttpError(503,'ATTENDANCE_STORAGE','点名结算的防重存储暂不可用，请稍后重试');
  const attendanceResult=await require('../lib/workflowLock.js').withLock(`student-${lesson.student_id}`,()=>require('../lib/absence.js').register(req,lesson,{deduct_hours:deduct,reason,pay_teacher:payTeacher,review_required:reviewRequired}));
  if (!attendanceResult.alreadyRecorded) {
    await notifyAttendance(req, {
      studentId: lesson.student_id,
      title: reviewRequired?"缺勤已登记，待管理员确认结算":"缺席登记",
      body: reviewRequired?"孩子缺勤已记录，是否扣除课时将由管理员确认。":`孩子未到课，本次${deduct ? `扣除 ${attendanceResult.deducted_hours} 小时` : "不扣课时"}。${reason?.trim() || "如有疑问请联系老师。"}`,
    });
    await audit(
      userId,
      "lesson.attendance",
      "lesson",
      lessonId,
      {
        result,
        reason: reason?.trim() || null,
        deduct_hours: deduct,
        deducted_hours: attendanceResult.deducted_hours,
        teacher_pay_amount: attendanceResult.teacher_pay_amount,
      },
      req.reqId,
    );
  }
  if (require("../lib/secureStore.js").ready())
    await require("../lib/makeupWorkflow.js").syncLesson({ ...lesson, status: "no_show" });
  ok(res, attendanceResult);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === '/history' && req.method === 'POST') {
    await requireAuth(req,res);
    requireRole(req,res,'admin');
    return ok(res,await require('../lib/historyLessons.js').save(req,req.body||{}));
  }
  const correction=url.pathname.match(/^\/([0-9a-f-]+)\/(correction|correction-preview)$/);
  if(correction){await requireAuth(req,res);requireRole(req,res,'admin','teacher');const module=require('../lib/lessonCorrections.js');
    if(correction[2]==='correction-preview'&&req.method==='POST')return ok(res,await module.preview(req,correction[1],req.body||{}));
    if(correction[2]==='correction'&&req.method==='PATCH')return ok(res,await module.save(req,correction[1],req.body||{}));}
  const rollCall = url.pathname.match(/^\/([0-9a-f-]+)\/roll-call$/);
  if (rollCall && req.method === "POST")
    return require("../lib/rollCall.js").run(req, res, rollCall[1], { complete, attendance });
  const receipt = url.pathname.match(/^\/([0-9a-f-]+)\/receipt$/);
  if (receipt && req.method === "POST") {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");
    ok(res, await require("../lib/lessonReceipt.js").publish(req, receipt[1]));
    return;
  }
  const m = url.pathname.match(/^\/([0-9a-f-]+)\/complete$/);
  if (m && req.method === "POST") return complete(req, res, m[1]);
  const mAtt = url.pathname.match(/^\/([0-9a-f-]+)\/attendance$/);
  if (mAtt && req.method === "POST") return attendance(req, res, mAtt[1]);
  const idMatch = url.pathname.match(/^\/([0-9a-f-]+)$/);
  if (idMatch && req.method === "GET") return getOne(req, res, idMatch[1]);
  if (idMatch && req.method === "PATCH") return reschedule(req, res, idMatch[1]);
  throw new HttpError(404, "NOT_FOUND", "unknown lesson route");
};
