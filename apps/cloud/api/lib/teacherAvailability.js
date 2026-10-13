const { z } = require("zod");
const store = require("./secureStore.js");
const { HttpError } = require("./errors.js");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  day = z.number().int().min(0).max(6);
const interval = z
  .object({ weekday: day, start: time, end: time })
  .refine((v) => v.start < v.end, "结束时间必须晚于开始时间");
const schema = z.object({
  revision: z.number().int().min(0),
  available: z.array(interval).max(35),
  weeklyBusy: z.array(interval).max(35),
  busy: z
    .array(
      z
        .object({
          id: z.string().uuid(),
          from: z.string().datetime(),
          to: z.string().datetime(),
          note: z.string().max(150).default(""),
        })
        .refine(
          (v) =>
            Date.parse(v.to) > Date.parse(v.from) &&
            Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
        ),
    )
    .max(100),
});
const key = (id) => `private/teacher-availability/${id}`;
async function get(id) {
  return store.ready()
    ? (await store.read(key(id), { revision: 0, available: [], weeklyBusy: [], busy: [] })).value
    : { revision: 0, available: [], weeklyBusy: [], busy: [] };
}
function spans(iso, minutes) {
  const from = Date.parse(iso),
    to = from + minutes * 60000,
    parts = [];
  if (!Number.isFinite(from) || !Number.isFinite(minutes) || !(minutes > 0) || minutes > 1440)
    throw new HttpError(400, "SCHEDULE_TIME", "上课时间无效");
  let cursor = from;
  while (cursor < to) {
    const local = new Date(cursor + 8 * 3600000),
      midnight =
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - 8 * 3600000,
      end = Math.min(midnight, to);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    parts.push({ weekday: local.getUTCDay(), start: minute, end: minute + (end - cursor) / 60000 });
    cursor = end;
  }
  return parts;
}
const minute = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
function check(cfg, lesson) {
  const from = Date.parse(lesson.scheduled_at),
    to = from + Number(lesson.duration_min) * 60000;
  if (cfg.busy.some((b) => Date.parse(b.from) < to && Date.parse(b.to) > from))
    return "教师个人时间已占用";
  for (const p of spans(lesson.scheduled_at, Number(lesson.duration_min))) {
    if (
      cfg.weeklyBusy.some(
        (b) => b.weekday === p.weekday && minute(b.start) < p.end && minute(b.end) > p.start,
      )
    )
      return "教师每周固定时间已占用";
    if (cfg.available.length) {
      const windows = cfg.available
        .filter((a) => a.weekday === p.weekday)
        .map((a) => ({ start: minute(a.start), end: minute(a.end) }))
        .sort((a, b) => a.start - b.start);
      let covered = p.start;
      for (const w of windows) {
        if (w.start <= covered) covered = Math.max(covered, w.end);
      }
      if (covered < p.end) return "不在教师可用时间内";
    }
  }
  return null;
}
async function assertAvailable(lesson) {
  if (!lesson.teacher_id) return;
  const cfg = await get(lesson.teacher_id),
    reason = check(cfg, lesson);
  if (reason) throw new HttpError(409, "TEACHER_UNAVAILABLE", reason);
}
function validate(body) {
  const p = schema.safeParse(body);
  if (!p.success) throw new HttpError(400, "AVAILABILITY_INVALID", "请检查星期和时间范围");
  return p.data;
}
async function withTeacherLocks(ids, run) {
  const list = [...new Set(ids.filter(Boolean))].sort();
  async function next(i) {
    return i === list.length
      ? run()
      : require("./workflowLock.js").withLock("teacher-calendar-" + list[i], () => next(i + 1));
  }
  return next(0);
}
async function save(id, body) {
  const p = schema.safeParse(body);
  if (!p.success) throw new HttpError(400, "AVAILABILITY_INVALID", "请检查星期和时间范围");
  return store.change(key(id), { revision: 0, available: [], weeklyBusy: [], busy: [] }, (old) => {
    if (old.revision !== p.data.revision)
      throw new HttpError(409, "AVAILABILITY_CHANGED", "时间设置已变化，请刷新重试");
    return { ...p.data, revision: old.revision + 1 };
  });
}
module.exports = { get, save, check, assertAvailable, spans, validate, withTeacherLocks };
