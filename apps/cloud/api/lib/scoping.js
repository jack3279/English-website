// 数据可见范围。Worker 用 service_role 绕过 RLS, 所以"谁能看谁"必须在应用代码里过滤。
// 约定: 返回 null 表示"不限制"(admin); 返回数组表示只允许这些 student_id。

const { getAdmin } = require("./supabase.js");

async function visibleStudentIds(req) {
  const { role, userId } = req.context;
  const admin = getAdmin();
  if (role === "admin") return null;

  if (role === "parent") {
    const { data, error } = await admin
      .from("parent_student_links")
      .select("student_id, parents!inner(profile_id)")
      .eq("parents.profile_id", userId);
    if (error) throw error;
    return [...new Set((data ?? []).map((r) => r.student_id).filter(Boolean))];
  }

  if (role === "teacher") {
    // 老师既能看自己名下的课(courses), 也能看代过的课(lessons)
    const [byCourse, byLesson] = await Promise.all([
      admin.from("courses").select("student_id").eq("teacher_id", userId),
      admin.from("lessons").select("student_id").eq("teacher_id", userId),
    ]);
    if (byCourse.error) throw byCourse.error;
    if (byLesson.error) throw byLesson.error;
    return [
      ...new Set(
        [...(byCourse.data ?? []), ...(byLesson.data ?? [])]
          .map((r) => r.student_id)
          .filter(Boolean),
      ),
    ];
  }

  return [];
}

// 单个学员是否可见。admin 恒 true。
async function canSeeStudent(req, studentId) {
  const { role } = req.context;
  if (role === "admin") return true;
  const ids = await visibleStudentIds(req);
  return (ids ?? []).includes(studentId);
}

module.exports = { visibleStudentIds, canSeeStudent };
