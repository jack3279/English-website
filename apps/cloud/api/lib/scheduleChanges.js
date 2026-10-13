const { warn } = require("./log.js");

async function addScheduleChanges(admin, lessons) {
  const results = [];
  for (let i = 0; i < lessons.length; i += 100) {
    const batch = lessons.slice(i, i + 100);
    try {
      const { data, error } = await admin
        .from("audit_log")
        .select("target_id, action, payload, created_at")
        .eq("target_type", "lesson")
        .in("action", ["lesson.reschedule", "schedule.update"])
        .in(
          "target_id",
          batch.map((l) => l.id),
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const changes = new Map();
      for (const entry of data || []) {
        const payload = entry.payload || {};
        const changed =
          entry.action === "lesson.reschedule"
            ? Date.parse(payload.from) !== Date.parse(payload.to)
            : (payload.schedule_changed ??
              !!(
                payload.scheduled_at ||
                payload.teacher_id ||
                payload.student_id ||
                payload.duration_min
              ));
        if (changed && !changes.has(entry.target_id)) changes.set(entry.target_id, entry);
      }
      results.push(
        ...batch.map((lesson) => {
          const entry = changes.get(lesson.id);
          return {
            ...lesson,
            change_history_available: (data || []).length < 1000,
            ...(entry
              ? {
                  rescheduled_at: entry.created_at,
                  previous_scheduled_at:
                    entry.payload?.from || entry.payload?.previous_scheduled_at || null,
                }
              : {}),
          };
        }),
      );
    } catch (error) {
      warn("schedule_change_history_failed", { error: error.message });
      results.push(...batch.map((lesson) => ({ ...lesson, change_history_available: false })));
    }
  }
  return results;
}
module.exports = { addScheduleChanges };
