const store = require("./secureStore.js");
const { z } = require("zod");
const { HttpError } = require("./errors.js");
const DEFAULT = {
  lessons: true,
  feedback: true,
  balance: true,
  leave: true,
  messages: true,
  announcements: true,
  payroll: true,
  backups: false,
};
const Input = z
  .object({
    categories: z
      .object(Object.fromEntries(Object.keys(DEFAULT).map((k) => [k, z.boolean().optional()])))
      .strict(),
  })
  .strict();
async function key(id) {
  return `private/notification-preferences/${await store.hash(id)}`;
}
async function read(id) {
  return store.ready()
    ? { ...DEFAULT, ...(await store.read(await key(id), DEFAULT)).value }
    : { ...DEFAULT };
}
async function save(id, body) {
  const parsed = Input.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "PREFERENCES_INVALID", "通知设置无效");
  const value = await store.change(await key(id), DEFAULT, (v) => ({
    ...DEFAULT,
    ...v,
    ...parsed.data.categories,
  }));
  return value;
}
function category(row) {
  if (String(row.title || "").includes("备份")) return "backups";
  if (String(row.title || "").includes("课酬")) return "payroll";
  if (["report", "class_report"].includes(row.type)) return "feedback";
  if (row.type === "renewal") return "balance";
  if (["leave", "makeup"].includes(row.type)) return "leave";
  if (["lesson_reminder", "lesson_rescheduled", "lesson_cancelled"].includes(row.type))
    return "lessons";
  if (row.type === "message") return "messages";
  if (row.type === "announcement") return "announcements";
  return null;
}
function muted(row, prefs) {
  const kind = category(row);
  return !!kind && prefs[kind] === false;
}
module.exports = { read, save, muted, DEFAULT };
