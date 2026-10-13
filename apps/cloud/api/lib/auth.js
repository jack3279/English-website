const { getAdmin } = require("./supabase.js");
const { unauthorized, forbidden } = require("./http.js");
const { HttpError } = require("./errors.js");
const { assertSessionActive } = require("./sessions.js");

async function authenticate(req, res, { required }) {
  if (req.__authVerified) return req.context;
  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    if (required) {
      unauthorized(res, "缺少 Authorization 头");
      throw new HttpError(401, "UNAUTHORIZED", "缺少 Authorization 头");
    }
    return null;
  }
  const jwt = m[1];
  const admin = (require('./supabase.js').getUnscopedAdmin||getAdmin)();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) {
    if (required) {
      unauthorized(res, "token 无效或已过期");
      throw new HttpError(401, "UNAUTHORIZED", "token 无效或已过期");
    }
    req.context = null;
    req.__authVerified = true;
    return null;
  }
  try {
    await assertSessionActive(data.user.id, jwt);
  } catch (e) {
    if (required) throw e;
    req.context = null;
    req.__authVerified = true;
    return null;
  }
  const profileRes = await admin
    .from("profiles")
    .select("id, role, full_name, branch_id, phone, is_test")
    .eq("id", data.user.id)
    .maybeSingle();
  // ⚠️ 这里**不能**从 user_metadata.role 回退角色。
  //
  // user_metadata 是**用户本人可写**的（Supabase 允许 updateUser 改自己的 metadata，
  // 拿到自己 token 就能改）。一旦 profiles 行缺失时回退读它，就等于开了一条提权后门：
  // 把 metadata.role 改成 "admin" 即可获得管理员权限。
  //
  // 现网两条建号路径（adminSeed.ensureProfile / importRows 建老师）都是
  // 「建 auth 用户 + 同时写 profiles」，所以 profile 缺失只可能是数据异常。
  // 这种情况按最小权限降级为 parent：能登录进家长视图、看不到任何管理数据，
  // 比直接 403 更友好（用户还能看到自己的课表），也绝不可能提权。
  // 真要恢复正确角色，让管理员补profiles 行即可（metadata 不再参与判定）。
  if (profileRes.error) {
    if (required) throw profileRes.error;
    return null;
  }
  let profile = profileRes.data;
  if (!profile) {
    const meta = data.user.user_metadata || {};
    profile = {
      id: data.user.id,
      // 硬编码 parent，不读meta.role
      role: "parent",
      full_name: meta.full_name || data.user.email,
      branch_id: null,
    };
  }
  req.context = {
    userId: profile.id,
    role: profile.is_test && data.user.app_metadata?.is_test_admin === true ? 'admin' : profile.role,
    isTestAccount: !!profile.is_test,
    fullName: profile.full_name,
    email: data.user.email || null,
    phone: profile.phone || null,
    branchId: profile.branch_id,
    jwt,
    supabase: require("./supabase.js").getUserClient(jwt),
  };
  req.__authVerified=true;
  return req.context;
}

async function requireAuth(req, res) {
  return authenticate(req, res, { required: true });
}

async function optionalAuth(req, res) {
  return authenticate(req, res, { required: false });
}

function requireRole(req, res, ...allowed) {
  if (!allowed.includes(req.context?.role)) {
    forbidden(res, `需要角色: ${allowed.join("/")}`);
    throw new HttpError(403, "FORBIDDEN", `需要角色: ${allowed.join("/")}`);
  }
}

module.exports = { requireAuth, optionalAuth, requireRole };
