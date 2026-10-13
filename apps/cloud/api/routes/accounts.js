const { z } = require("zod");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin, createAuthClient } = require("../lib/supabase.js");
const { restInsert } = require("../lib/rest.js");
const { HttpError } = require("../lib/errors.js");
const { ok, notFound } = require("../lib/http.js");
const { record: audit } = require("../lib/audit.js");
function environment() {
  return globalThis.__CLOUDFLARE_ENV || process.env;
}
function headers() {
  const env = environment();
  return {
    "content-type": "application/json",
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}
async function users() {
  const response = await fetch(
    `${environment().SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    { headers: headers() },
  );
  if (!response.ok)
    throw new HttpError(503, "ACCOUNTS_UNAVAILABLE", "账号列表暂时无法读取，请重试");
  const value = await response.json();
  return Array.isArray(value) ? value : value.users || [];
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const path = new URL(req.url, "http://x").pathname.replace(/^\/accounts/, "") || "/";
  if (req.method === "POST" && path === "/password") {
    const checked = z
      .object({
        id: z.string().uuid(),
        password: z
          .string()
          .min(10)
          .max(128)
          .regex(/[A-Za-z]/)
          .regex(/[0-9]/),
        current_password: z.string().min(1).max(128),
        confirmed: z.literal(true),
      })
      .strict()
      .safeParse(req.body);
    if (!checked.success)
      throw new HttpError(400, "BAD_REQUEST", "请核对账号和密码，并确认已核实用户身份");
    const input = checked.data;
    if (input.id === req.context.userId)
      throw new HttpError(400, "SELF_PASSWORD_CHANGE", "自己的密码请在账号设置中修改");
    const { data: identity, error: identityError } = await getAdmin().auth.getUser(req.context.jwt);
    if (identityError || identity?.user?.id !== req.context.userId || !identity.user.email)
      throw new HttpError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
    const authClient = createAuthClient();
    const { data: proof, error: proofError } = await authClient.auth.signInWithPassword({
      email: identity.user.email,
      password: input.current_password,
    });
    if (proofError || proof?.user?.id !== req.context.userId)
      throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "当前管理员密码不正确");
    try {
      const { data: targets, error } = await getAdmin()
        .from("profiles")
        .select("id")
        .eq("id", input.id)
        .limit(1);
      if (error) throw error;
      if (!targets?.length) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "没有找到该账号");
      const updated = await fetch(`${environment().SUPABASE_URL}/auth/v1/admin/users/${input.id}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ password: input.password }),
      });
      if (!updated.ok)
        throw new HttpError(503, "PASSWORD_UPDATE_FAILED", "密码暂时未能重置，请稍后重试");
      const account = await updated.json();
      if (account.id !== input.id)
        throw new HttpError(503, "PASSWORD_UPDATE_FAILED", "密码重置结果无法确认，请重新登录核对");
      await audit(
        req.context.userId,
        "auth.password_reset_by_admin",
        "user",
        input.id,
        null,
        req.reqId,
      );
      ok(res, { updated: true, message: "密码已重置，请将新密码私下交付给账号本人" });
      return;
    } finally {
      try {
        await authClient.auth.signOut({ scope: "local" });
      } catch {
        /* best effort */
      }
    }
  }
  if (req.method === "GET" && path === "/") {
    const [{ data: profiles, error }, accounts] = await Promise.all([
      getAdmin().from("profiles").select("id,full_name,role,branch_id,phone,is_test").limit(1000),
      users(),
    ]);
    if (error) throw error;
    const byId = new Map(accounts.map((user) => [user.id, user]));
    ok(res, {
      items: (profiles || []).map((profile) => ({
        id: profile.id,
        name: profile.full_name,
        role: profile.is_test && byId.get(profile.id)?.app_metadata?.is_test_admin === true ? 'admin' : profile.role,
        email: byId.get(profile.id)?.email || null,
        phone: profile.phone || null,
        lastSignInAt: byId.get(profile.id)?.last_sign_in_at || null,
      })),
      truncated: (profiles || []).length >= 1000 || accounts.length >= 1000,
    });
    return;
  }
  if (req.method === "POST" && (path === "/admin" || path === "/create")) {
    const checked = z
      .object({
        email: z.string().trim().email().max(254),
        name: z.string().trim().min(1).max(80),
        password: z
          .string()
          .min(10)
          .max(128)
          .regex(/[A-Za-z]/)
          .regex(/[0-9]/),
        current_password: z.string().min(1).max(128),
        confirmed: z.literal(true),
        role: z.enum(["parent", "teacher"]).optional(),
        phone: z.string().trim().max(30).optional(),
        student_ids: z.array(z.string().uuid()).max(50).optional(),
        teacher_hourly_pay: z.number().min(0).max(100000).optional(),
        teacher_pay_currency: z.enum(["PHP", "CNY", "USD", "EUR", "GBP"]).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!checked.success)
      throw new HttpError(400, "BAD_REQUEST", "请核对邮箱、姓名和密码，并确认管理员身份");
    const input = checked.data;
    const role = path === "/admin" ? "admin" : input.role || "parent";
    const studentIds = [...new Set(input.student_ids || [])];
    if (role !== "parent" && studentIds.length)
      throw new HttpError(400, "BAD_REQUEST", "只有家长账号可以绑定孩子");
    if (input.phone && (!/^[+0-9 ()-]{5,30}$/.test(input.phone)||input.phone.replace(/\D/g,"").length<5))
      throw new HttpError(400, "BAD_REQUEST", "请填写有效的联系电话");
    const { data: identity, error: identityError } = await getAdmin().auth.getUser(req.context.jwt);
    if (identityError || identity?.user?.id !== req.context.userId || !identity.user.email)
      throw new HttpError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
    const authClient = createAuthClient();
    const { data: proof, error: proofError } = await authClient.auth.signInWithPassword({
      email: identity.user.email,
      password: input.current_password,
    });
    if (proofError || proof?.user?.id !== req.context.userId)
      throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "当前管理员密码不正确");
    try {
      if (studentIds.length) {
        const { data: students, error } = await getAdmin()
          .from("students")
          .select("id")
          .in("id", studentIds);
        if (error) throw error;
        if (new Set((students || []).map((row) => row.id)).size !== studentIds.length)
          throw new HttpError(404, "STUDENT_NOT_FOUND", "所选学员不存在，请刷新后重新选择");
      }
      const existing = await users();
      if (existing.some((user) => user.email?.toLowerCase() === input.email.toLowerCase()))
        throw new HttpError(
          409,
          "ACCOUNT_EXISTS",
          "该邮箱已有账号，请在列表中核对角色，不要重复创建",
        );
      if (existing.length >= 1000)
        throw new HttpError(409, "ACCOUNT_LIMIT", "账号数量超出当前开户范围，请联系维护人员");
      const created = await fetch(`${environment().SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          email_confirm: true,
          user_metadata: { full_name: input.name },
        }),
      });
      if (!created.ok)
        throw new HttpError(503, "ACCOUNT_CREATE_FAILED", "账号暂时未能创建，请稍后重试");
      const user = await created.json();
      if (!z.string().uuid().safeParse(user.id).success)
        throw new HttpError(503, "ACCOUNT_CREATE_FAILED", "账号创建结果无法确认，请联系维护人员");
      let parentId = null,
        teacherId = null;
      try {
        const profiles = await restInsert("profiles", {
          id: user.id,
          full_name: input.name,
          role,
          branch_id: req.context.branchId || null,
          phone: input.phone || null,
        });
        if (!profiles?.some((row) => row.id === user.id))
          throw new Error("profile creation unconfirmed");
        if (role === "parent") {
          const parents = await restInsert("parents", {
            profile_id: user.id,
            full_name: input.name,
          });
          parentId = parents?.[0]?.id;
          if (!z.string().uuid().safeParse(parentId).success)
            throw new Error("parent creation unconfirmed");
          if (studentIds.length) {
            const linked = await restInsert(
              "parent_student_links",
              studentIds.map((studentId) => ({
                parent_id: parentId,
                student_id: studentId,
                relation: "guardian",
              })),
            );
            if (
              new Set(
                (linked || [])
                  .filter((row) => row.parent_id === parentId)
                  .map((row) => row.student_id),
              ).size !== studentIds.length
            )
              throw new Error("family links unconfirmed");
          }
        }
        if (role === "teacher") {
          const teachers = await restInsert("teachers", {
            profile_id: user.id,
            hourly_pay: input.teacher_hourly_pay || 0,
            pay_currency: input.teacher_pay_currency || "PHP",
            active: true,
          });
          teacherId = teachers?.[0]?.id;
          if (!z.string().uuid().safeParse(teacherId).success)
            throw new Error("teacher creation unconfirmed");
        }
      } catch {
        // 仅回滚刚创建的新账号，不修改任何已存在的用户或业务数据。
        const removed = await fetch(
          `${environment().SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
          { method: "DELETE", headers: headers() },
        );
        throw new HttpError(
          503,
          "ACCOUNT_CREATE_FAILED",
          removed.ok
            ? "开户未完成，已回滚，请稍后重试"
            : "开户未完成，请联系维护人员核对该邮箱后重试",
        );
      }
      await audit(
        req.context.userId,
        role === "admin" ? "auth.admin_created" : "auth.account_created",
        "user",
        user.id,
        { email: input.email, role, linked_students: studentIds.length },
        req.reqId,
      );
      ok(res, {
        id: user.id,
        email: input.email,
        role,
        parentId,
        teacherId,
        linkedStudents: studentIds.length,
        message:
          role === "admin"
            ? "管理员账号已创建，请用新账号登录核对"
            : role === "parent"
              ? `家长账号已开通${studentIds.length ? `，已绑定 ${studentIds.length} 位学员` : "，可在学员详情中绑定孩子"}`
              : "教师账号与档案已创建，可在教师档案中完善专长和课酬",
      });
      return;
    } finally {
      try {
        await authClient.auth.signOut({ scope: "local" });
      } catch {
        /* best effort */
      }
    }
  }
  notFound(res);
};
module.exports.listAuthUsers = users;
