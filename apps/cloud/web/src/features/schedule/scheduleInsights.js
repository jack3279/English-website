export const DEFAULT_LOAD_LIMITS = {
  dailyHours: 6,
  weeklyHours: 25,
  consecutiveLessons: 3,
  breakMinutes: 15,
};
const OFFSET = 8 * 3600_000;
const DAY = 86400_000;

export function schoolDay(iso) {
  return new Date(new Date(iso).getTime() + OFFSET).toISOString().slice(0, 10);
}
export function schoolInput(iso) {
  return new Date(new Date(iso).getTime() + OFFSET).toISOString().slice(0, 16);
}
export function inputToIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  return Number.isFinite(date.getTime()) && schoolInput(date) === value ? date.toISOString() : null;
}
export function schoolWeekWindow(iso) {
  const date = new Date(`${schoolDay(iso)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return {
    from: new Date(date.getTime() - OFFSET).toISOString(),
    to: new Date(date.getTime() + 7 * DAY - OFFSET).toISOString(),
  };
}
export function teachingLesson(lesson) {
  return ["scheduled", "completed"].includes(lesson.status) && lesson.leave_status !== "approved";
}
export function canMoveLesson(lesson) {
  return lesson.status === "scheduled" && lesson.leave_status !== "approved";
}
export function lessonAppearance(lesson) {
  if (lesson.status === "cancelled")
    return {
      label: lesson.leave_status === "approved" ? "已取消 · 请假" : "已取消",
      className:
        "bg-gray-100 text-gray-600 border-gray-300 italic dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
    };
  if (lesson.status === "no_show")
    return {
      label: "缺席",
      className:
        "bg-danger-50 text-danger-700 border-danger-400 dark:bg-danger-900/30 dark:text-danger-200 dark:border-danger-600",
    };
  if (lesson.leave_status === "approved")
    return {
      label: "已请假",
      className:
        "bg-warning-50 text-warning-800 border-warning-300 italic dark:bg-warning-900/30 dark:text-warning-200 dark:border-warning-700",
    };
  if (lesson.leave_status === "pending")
    return {
      label: "请假待批",
      className:
        "bg-warning-50 text-warning-800 border-warning-400 dark:bg-warning-900/30 dark:text-warning-200 dark:border-warning-600",
    };
  if (lesson.rescheduled_at)
    return {
      label: lesson.status === "completed" ? "已完成 · 已调课" : "已调课",
      className:
        "bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-600",
    };
  if (lesson.status === "completed")
    return {
      label: "已完成",
      className:
        "bg-success-50 text-success-800 border-success-300 dark:bg-success-900/30 dark:text-success-200 dark:border-success-700",
    };
  return {
    label: "待上课",
    className:
      "bg-primary-50 text-primary-800 border-primary-200 dark:bg-primary-900/30 dark:text-primary-200 dark:border-primary-700",
  };
}
export function matchesScheduleFilter(lesson, filter) {
  if (filter === "all") return true;
  if (filter === "exceptions")
    return (
      ["cancelled", "no_show"].includes(lesson.status) ||
      ["approved", "pending"].includes(lesson.leave_status) ||
      !!lesson.rescheduled_at
    );
  if (filter === "leave") return ["pending", "approved"].includes(lesson.leave_status);
  if (filter === "rescheduled") return !!lesson.rescheduled_at;
  return lesson.status === filter;
}

export function analyzeSchedule(lessons, limits = DEFAULT_LOAD_LIMITS) {
  const active = [...new Map(lessons.map((lesson) => [lesson.id, lesson])).values()]
    .filter(teachingLesson)
    .map((lesson) => ({
      lesson,
      start: Date.parse(lesson.scheduled_at),
      minutes: Number(lesson.duration_min || 60),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.start) &&
        Number.isFinite(item.minutes) &&
        item.minutes > 0 &&
        item.minutes <= 10080,
    );
  const conflicts = [],
    warnings = [],
    byLesson = new Map();
  const add = (id, text) => {
    const labels = byLesson.get(id) || [];
    if (!labels.includes(text)) labels.push(text);
    byLesson.set(id, labels);
  };
  for (const lesson of lessons) {
    if (
      teachingLesson(lesson) &&
      (!Number.isFinite(Number(lesson.duration_min || 60)) ||
        Number(lesson.duration_min || 60) > 10080 ||
        Number(lesson.duration_min || 60) <= 0)
    ) {
      warnings.push({
        type: "invalid",
        teacherName: lesson.profiles?.full_name || "老师",
        period: lesson.scheduled_at?.slice(0, 10) || "",
        lessonIds: [lesson.id],
      });
      add(lesson.id, "课节时长异常");
    }
  }
  const checkGroups = (key, kind) => {
    const groups = new Map();
    for (const item of active) {
      const id = item.lesson[key];
      if (!id) continue;
      const list = groups.get(id) || [];
      list.push(item);
      groups.set(id, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 0; i < list.length; i++)
        for (
          let j = i + 1;
          j < list.length && list[j].start < list[i].start + list[i].minutes * 60000;
          j++
        ) {
          if (list[i].lesson.id === list[j].lesson.id) continue;
          conflicts.push({ kind, first: list[i].lesson, second: list[j].lesson });
          add(list[i].lesson.id, kind === "teacher" ? "教师时间冲突" : "学员时间冲突");
          add(list[j].lesson.id, kind === "teacher" ? "教师时间冲突" : "学员时间冲突");
        }
    }
  };
  checkGroups("teacher_id", "teacher");
  checkGroups("student_id", "student");
  const days = new Map(),
    weeks = new Map();
  for (const item of active) {
    if (!item.lesson.teacher_id) continue;
    let cursor = item.start,
      end = item.start + item.minutes * 60000;
    while (cursor < end) {
      const day = schoolDay(cursor),
        next = Date.parse(`${day}T00:00:00+08:00`) + DAY;
      const minutes = (Math.min(end, next) - cursor) / 60000;
      const week = schoolDay(schoolWeekWindow(cursor).from);
      for (const [map, period] of [
        [days, day],
        [weeks, week],
      ]) {
        const key = `${item.lesson.teacher_id}:${period}`;
        const group = map.get(key) || {
          teacherId: item.lesson.teacher_id,
          teacherName: item.lesson.profiles?.full_name || "老师",
          period,
          minutes: 0,
          ids: new Set(),
          items: [],
        };
        group.minutes += minutes;
        group.ids.add(item.lesson.id);
        if (map === days) group.items.push(item);
        map.set(key, group);
      }
      cursor = Math.min(end, next);
    }
  }
  for (const [map, type, hours] of [
    [days, "day", limits.dailyHours],
    [weeks, "week", limits.weeklyHours],
  ])
    for (const group of map.values()) {
      if (group.minutes > Number(hours) * 60) {
        const text = type === "day" ? "日课时超限" : "周课时超限";
        warnings.push({
          type,
          teacherId: group.teacherId,
          teacherName: group.teacherName,
          period: group.period,
          hours: Math.round((group.minutes / 60) * 100) / 100,
          limit: hours,
          lessonIds: [...group.ids],
        });
        group.ids.forEach((id) => add(id, text));
      }
    }
  for (const group of days.values()) {
    const list = [...new Map(group.items.map((item) => [item.lesson.id, item])).values()].sort(
      (a, b) => a.start - b.start,
    );
    let chain = [];
    const finish = () => {
      if (chain.length >= limits.consecutiveLessons) {
        const ids = chain.map((item) => item.lesson.id);
        warnings.push({
          type: "consecutive",
          teacherId: group.teacherId,
          teacherName: group.teacherName,
          period: group.period,
          count: chain.length,
          lessonIds: ids,
        });
        ids.forEach((id) => add(id, "短间隔连堂"));
      }
    };
    for (const item of list) {
      const previous = chain[chain.length - 1];
      const gap = previous
        ? (item.start - previous.start - previous.minutes * 60000) / 60000
        : Infinity;
      if (previous && (gap < 0 || gap >= limits.breakMinutes)) {
        finish();
        chain = [];
      }
      chain.push(item);
    }
    finish();
  }
  return { conflicts, warnings, byLesson };
}

export function assignLanes(items) {
  const groups = new Map(),
    result = [];
  for (const item of items) {
    const list = groups.get(item.colIdx) || [];
    list.push({ ...item });
    groups.set(item.colIdx, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.lesson.scheduled_at) - Date.parse(b.lesson.scheduled_at));
    let cluster = [],
      laneEnds = [],
      clusterEnd = -Infinity;
    const finish = () => {
      cluster.forEach((item) => {
        item.laneCount = laneEnds.length;
        result.push(item);
      });
      cluster = [];
      laneEnds = [];
    };
    for (const item of list) {
      const start = Date.parse(item.lesson.scheduled_at),
        end = start + Number(item.lesson.duration_min || 60) * 60000;
      if (cluster.length && start >= clusterEnd) finish();
      let slot = laneEnds.findIndex((value) => value <= start);
      if (slot < 0) slot = laneEnds.length;
      laneEnds[slot] = end;
      item.slot = slot;
      cluster.push(item);
      clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end);
    }
    if (cluster.length) finish();
  }
  return result;
}
