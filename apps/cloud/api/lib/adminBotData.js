const { getAdmin } = require("./supabase.js");
const { getDailyLowBalanceReport } = require("./alerts.js");
const { HttpError } = require("./errors.js");
const DAY = 86400000;
async function result(query) {
  if (typeof query.abortSignal === "function")
    query = query.abortSignal(AbortSignal.timeout(15000));
  const { data, error } = await query;
  if (error)
    throw new HttpError(503, "BOT_DATA_UNAVAILABLE", "教务数据暂时无法完整读取，不能给出准确结论");
  return data || [];
}
async function snapshot(includeNames = false, now = Date.now()) {
  const db = getAdmin(),
    day = new Date(now + 8 * 3600000).toISOString().slice(0, 10),
    start = new Date(`${day}T00:00:00+08:00`).toISOString(),
    end = new Date(Date.parse(start) + 2 * DAY).toISOString();
  const [alerts, leaves, makeups, leads, lessons] = await Promise.all([
    getDailyLowBalanceReport(db),
    result(db.from("leave_requests").select("id,created_at").eq("status", "pending").limit(101)),
    result(db.from("makeups").select("id,created_at").eq("status", "pending").limit(101)),
    result(db.from("leads").select("id,created_at").eq("status", "new").limit(101)),
    result(
      db
        .from("lessons")
        .select(
          "id,student_id,scheduled_at,duration_min,status,students:student_id(full_name),profiles:teacher_id(full_name)",
        )
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .order("scheduled_at")
        .limit(101),
    ),
  ]);
  const overdue = await result(
    db
      .from("lessons")
      .select("id,scheduled_at,duration_min")
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date(now - 7 * DAY).toISOString())
      .lt("scheduled_at", new Date(now - 3600000).toISOString())
      .limit(101),
  );
  const finished = await result(
    db
      .from("lessons")
      .select("id")
      .eq("status", "completed")
      .gte("completed_at", new Date(now - 7 * DAY).toISOString())
      .lt("completed_at", new Date(now - DAY).toISOString())
      .limit(101),
  );
  const records = finished.length
    ? await result(
        db
          .from("records")
          .select("id,lesson_id")
          .in(
            "lesson_id",
            finished.map((l) => l.id),
          ),
      )
    : [];
  const feeds = records.length
    ? await result(
        db
          .from("parent_feeds")
          .select("record_id")
          .in(
            "record_id",
            records.map((r) => r.id),
          ),
      )
    : [];
  const publishedRecords = new Set(feeds.map((f) => f.record_id)),
    publishedLessons = new Set(
      records.filter((r) => publishedRecords.has(r.id)).map((r) => r.lesson_id),
    );
  const upcoming = lessons.filter(
    (l) =>
      l.status === "scheduled" &&
      Date.parse(l.scheduled_at) > now &&
      Date.parse(l.scheduled_at) <= now + DAY,
  );
  const students = [...new Set(upcoming.map((l) => l.student_id))];
  const balances = students.length
    ? await result(
        db.from("student_balance").select("student_id,remaining_hours").in("student_id", students),
      )
    : [];
  const byId = new Map(balances.map((b) => [b.student_id, Number(b.remaining_hours)]));
  const next = new Map();
  for (const lesson of upcoming) {
    if (!next.has(lesson.student_id)) next.set(lesson.student_id, lesson);
  }
  const insufficient = [...next.values()].filter(
    (l) => byId.has(l.student_id) && byId.get(l.student_id) < Number(l.duration_min) / 60,
  );
  const low = [...(alerts.zero_balance || []), ...(alerts.low_balance || [])];
  return {
    asOf: new Date(now).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    timezone: "Asia/Shanghai",
    lowBalanceThresholdHours: alerts.threshold,
    lowBalanceStudents: low.length,
    needsAttention: {
      leavePendingOver2Hours: leaves.filter((r) => Date.parse(r.created_at) < now - 2 * 3600000)
        .length,
      makeupPendingOver24Hours: makeups.filter((r) => Date.parse(r.created_at) < now - DAY).length,
      newLeadsUncontactedOver24Hours: leads.filter((r) => Date.parse(r.created_at) < now - DAY)
        .length,
      nextLessonBalanceInsufficient: insufficient.length,
      lessonNotCompletedOver1Hour: overdue.filter(
        (l) => Date.parse(l.scheduled_at) + Number(l.duration_min || 60) * 60000 + 3600000 < now,
      ).length,
      feedbackUnpublishedOver24Hours: finished.filter((l) => !publishedLessons.has(l.id)).length,
    },
    lessonCount: lessons.length,
    lessonDetailsTruncated: lessons.length > 20,
    tomorrowAndToday: lessons.slice(0, 20).map((l) => ({
      time: l.scheduled_at,
      durationMinutes: l.duration_min,
      status: l.status,
      ...(includeNames ? { student: l.students?.full_name, teacher: l.profiles?.full_name } : {}),
    })),
    ...(includeNames
      ? {
          lowBalanceNames: low
            .slice(0, 20)
            .map((s) => ({ name: s.full_name, hours: s.remaining_hours })),
        }
      : {}),
    truncated:
      leaves.length > 100 ||
      makeups.length > 100 ||
      leads.length > 100 ||
      lessons.length > 100 ||
      overdue.length > 100 ||
      finished.length > 100,
    processUrl: "https://17say.org/admin/operations",
  };
}
async function ownerAccount(id) {
  const { data, error } = await getAdmin().auth.admin.getUserById(id);
  if (error || data?.user?.id !== id || Date.parse(data.user.banned_until) > Date.now())
    throw new HttpError(403, "BOT_OWNER_INACTIVE", "绑定管理员账号不可用，机器人已停止读取数据");
}
async function upcomingLessons(minutes, now = Date.now()) {
  const from = new Date(now + Math.max(0, minutes - 10) * 60000).toISOString();
  const to = new Date(now + minutes * 60000).toISOString();
  return result(
    getAdmin()
      .from("lessons")
      .select(
        "id,scheduled_at,duration_min,status,students:student_id(full_name),profiles:teacher_id(full_name),courses:course_id(name)",
      )
      .eq("status", "scheduled")
      .gt("scheduled_at", from)
      .lte("scheduled_at", to)
      .order("scheduled_at")
      .limit(100),
  );
}
async function currentLesson(id) {
  const rows = await result(
    getAdmin()
      .from("lessons")
      .select(
        "id,scheduled_at,duration_min,status,students:student_id(full_name),profiles:teacher_id(full_name),courses:course_id(name)",
      )
      .eq("id", id)
      .limit(1),
  );
  return rows[0] || null;
}
module.exports = { snapshot, ownerAccount, upcomingLessons, currentLesson };
