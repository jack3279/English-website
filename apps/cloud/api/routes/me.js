const { requireAuth } = require("../lib/auth.js");
const { ok, notFound } = require("../lib/http.js");
const { getAdmin } = require("../lib/supabase.js");
const { visibleStudentIds } = require("../lib/scoping.js");
const { pickRenewalAlerts } = require("../src/scheduled.js");
const { listMySessions, revokeSession } = require("../lib/sessions.js");
const { createAuthClient } = require("../lib/supabase.js");
const { z } = require("zod");
const { HttpError } = require("../lib/errors.js");
const { record: audit } = require("../lib/audit.js");
const { getSettings } = require("../lib/institutionSettings.js");

// 返回给任意登录用户: 身份信息
async function profile(req, res) {
  const { userId, role, fullName, branchId } = req.context;

  let branchName = null;
  if (branchId) {
    const { data } = await getAdmin().from("branches").select("name").eq("id", branchId).single();
    branchName = data?.name ?? null;
  }

  ok(res, {
    id: userId,
    role,
    full_name: fullName,
    email: req.context.email,
    phone: req.context.phone,
    branch_id: branchId,
    branch_name: branchName,
    is_test_account: !!req.context.isTestAccount,
    data_scope: req.context.dataScope || (req.context.isTestAccount ? 'test' : 'production'),
  });
}

async function changePassword(req, res) {
  const input = z
    .object({
      current_password: z.string().min(1).max(128),
      new_password: z
        .string()
        .min(10)
        .max(128)
        .regex(/[A-Za-z]/)
        .regex(/[0-9]/),
    })
    .strict()
    .safeParse(req.body);
  if (!input.success)
    throw new HttpError(400, "BAD_PASSWORD", "新密码须为 10～128 位，并包含字母和数字");
  if (input.data.current_password === input.data.new_password)
    throw new HttpError(400, "BAD_PASSWORD", "新密码不能与当前密码相同");
  const { data: identity, error: identityError } = await getAdmin().auth.getUser(req.context.jwt);
  if (identityError || identity?.user?.id !== req.context.userId || !identity.user.email)
    throw new HttpError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
  const authClient = createAuthClient();
  const { data: proof, error: proofError } = await authClient.auth.signInWithPassword({
    email: identity.user.email,
    password: input.data.current_password,
  });
  if (proofError || proof?.user?.id !== req.context.userId)
    throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确");
  try {
    const env = globalThis.__CLOUDFLARE_ENV || process.env;
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${req.context.userId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ password: input.data.new_password }),
    });
    if (!response.ok)
      throw new HttpError(503, "PASSWORD_UPDATE_FAILED", "密码暂时未能修改，请稍后重试");
    const changed = await response.json();
    if (changed.id !== req.context.userId)
      throw new HttpError(503, "PASSWORD_UPDATE_FAILED", "密码修改结果未能确认，请重新登录核对");
  } finally {
    // 密码验证生成的一次性会话不保留。登出失败不改变密码更新的结果。
    try {
      await authClient.auth.signOut({ scope: "local" });
    } catch {
      /* best effort */
    }
  }
  await audit(
    req.context.userId,
    "auth.password_changed",
    "user",
    req.context.userId,
    null,
    req.reqId,
  );
  ok(res, { changed: true, message: "密码已修改，请重新登录" });
}

// 课时包预警: 哪些孩子的课时快用完 / 快到期
// 判定口径与每日 Cron 的续费提醒**共用同一个函数** (pickRenewalAlerts), 保证"推送的消息"和"页面看到的"完全一致。
// 可见范围走 scoping: parent 只看自己孩子, teacher 看自己名下的学员, admin 不限。
async function renewal(req, res) {
  const ids = await visibleStudentIds(req);
  if (Array.isArray(ids) && ids.length === 0) {
    ok(res, { items: [] });
    return;
  }

  const data=await require('../lib/renewalBalances.js').loadRenewalPackages(getAdmin(),ids);

  // 仅在读学员提示续费（停课/休学/结课/退费均不提示）
  const rows = (data ?? []).filter((p) => p.students?.status === "active");
  const actualRows=await require('../lib/renewalBalances.js').withStudentBalances(getAdmin(),rows);
  const items = pickRenewalAlerts(actualRows, Date.now(), await getSettings()).map((a) => ({
    student_id: a.pack.student_id,
    student_name: a.pack.students?.full_name ?? "",
    package_id: a.pack.id,
    package_name: a.pack.package_types?.name ?? "课时包",
    remaining_hours: a.balance,
    total_hours: a.total,
    expires_at: a.pack.expires_at ?? null,
    stage: a.stage,
  }));

  ok(res, { items });
}

module.exports = async function handler(req, res) {
  await requireAuth(req, res);

  const url = new URL(req.url, "http://x");
  if (url.pathname === "/preferences" && ["GET", "PATCH"].includes(req.method)) {
    const prefs = require("../lib/notificationPreferences.js");
    const categories =
      req.method === "GET"
        ? await prefs.read(req.context.userId)
        : await prefs.save(req.context.userId, req.body);
    ok(res, { categories, storageReady: require("../lib/secureStore.js").ready() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/password") return changePassword(req, res);
  if (req.method === "GET" && url.pathname === "/renewal") {
    return renewal(req, res);
  }

  // 多设备登录追踪 —— 用户自己查看 + 远程登出
  // GET /me/sessions          -> 当前用户活跃设备列表
  // DELETE /me/sessions/:id   -> 标记某设备为已撤销 (软删除, 列表不再显示)
  if (req.method === "GET" && url.pathname === "/sessions") {
    const items = await listMySessions(req.context.userId, req.context.jwt);
    ok(res, { items });
    return;
  }
  const mSess = url.pathname.match(/^\/sessions\/([^/]+)$/);
  if (req.method === "DELETE" && mSess) {
    const id = mSess[1];
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      notFound(res, "session id 非法");
      return;
    }
    const updated = await revokeSession(req.context.userId, id);
    if (updated === 0) {
      notFound(res, "session 不存在或已撤销");
      return;
    }
    ok(res, { revoked: true, id });
    return;
  }

  return profile(req, res);
};
