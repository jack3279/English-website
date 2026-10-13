export function safeMeetingUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function validLessonDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function lessonTimeRange(lesson) {
  const start = validLessonDate(lesson.scheduled_at);
  if (!start) return "时间待定";
  const end = new Date(start.getTime() + Number(lesson.duration_min || 0) * 60000);
  const fmt = (date) =>
    date.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(start)}–${fmt(end)}`;
}
