const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { HttpError } = require("../lib/errors.js");
const { ok } = require("../lib/http.js");
const availability = require("../lib/teacherAvailability.js");
module.exports = async (req, res) => {
  await requireAuth(req, res);
  requireRole(req, res, "admin", "teacher");
  const url = new URL(req.url, "http://x"),
    id = url.pathname.split("/")[1];
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new HttpError(400, "TEACHER_ID", "请选择教师");
  if (req.context.role === "teacher" && id !== req.context.userId)
    throw new HttpError(403, "FORBIDDEN", "只能管理自己的时间");
  const found = await getAdmin()
    .from("teachers")
    .select("profile_id")
    .eq("profile_id", id)
    .maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) throw new HttpError(404, "NOT_FOUND", "教师不存在");
  if (req.method === "GET") return ok(res, await availability.get(id));
  if (req.method === "POST") {
    const valid = availability.validate(req.body);
    return availability.withTeacherLocks([id], async () => {
      const future = await getAdmin()
        .from("lessons")
        .select("id,teacher_id,scheduled_at,duration_min")
        .eq("teacher_id", id)
        .eq("status", "scheduled")
        .gte("scheduled_at", new Date(Date.now() - 86400000).toISOString())
        .limit(501);
      if (future.error) throw future.error;
      if (future.data?.length > 500)
        throw new HttpError(409, "CALENDAR_TOO_LARGE", "待上课程超过500节，请联系管理员分批核对");
      for (const lesson of future.data || []) {
        const reason = availability.check({ ...valid, available: [] }, lesson);
        if (reason)
          throw new HttpError(409, "BUSY_LESSON_CONFLICT", "个人占用与已排课程冲突，请先调整课程");
      }
      return ok(res, await availability.save(id, valid));
    });
  }
  throw new HttpError(405, "METHOD_NOT_ALLOWED", "method not allowed");
};
