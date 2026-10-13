// 多设备登录追踪 —— 登录/refresh 成功后插入一行 auth_sessions,
// 用于 admin / 用户自己 查看「哪些设备在登录」并可远程登出。
//
// 隐私设计:
//   - 新版存稳定会话ID的 SHA256 指纹；兼容旧版刷新令牌哈希，不存凭据明文。
//   - IP 只存第一段 (例如 "203.0.113.*"), 避免完整 IP 留在审计日志
//   - 不存密码 (老规矩)
//   - 用户/管理员只能看到自己/本机构的 sessions

const crypto = require("node:crypto");
const { getAdmin } = require("./supabase.js");
const { restPatch, restInsert } = require("./rest.js");
const { warn } = require("./log.js");
const { HttpError } = require("./errors.js");

function sessionFingerprint(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split(".")[1], "base64url").toString());
    if (!/^[0-9a-f-]{36}$/i.test(payload.session_id || "")) return null;
    return "session:" + crypto.createHash("sha256").update(payload.session_id).digest("hex");
  } catch { return null; }
}
// JWT 必须先经 Supabase 验证；指纹只用于查撤销状态，不承担身份验证。
async function assertSessionActive(userId, accessToken) {
  const fingerprint = sessionFingerprint(accessToken);
  if (!fingerprint) return;
  const { data, error } = await getAdmin().from("auth_sessions").select("id")
    .eq("user_id", userId).eq("refresh_token_hash", fingerprint).not("revoked_at", "is", null).limit(1);
  if (error) throw new HttpError(503, "SESSION_CHECK_FAILED", "暂时无法验证登录设备，请稍后重试");
  if (data?.length) throw new HttpError(401, "SESSION_REVOKED", "该登录设备已退出，请重新登录");
}
async function assertRefreshActive(refreshToken) {
  const hash = hashRefreshToken(refreshToken);
  if (!hash) return;
  const { data, error } = await getAdmin().from("auth_sessions").select("id")
    .eq("refresh_token_hash", hash).not("revoked_at", "is", null).limit(1);
  if (error) throw new HttpError(503, "SESSION_CHECK_FAILED", "暂时无法验证登录设备，请稍后重试");
  if (data?.length) throw new HttpError(401, "SESSION_REVOKED", "该登录设备已退出，请重新登录");
}

function hashRefreshToken(token) {
  if (!token) return null;
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// 从 UA 解析 "Chrome on Windows" / "Safari on iPhone" 这种标签
function parseDeviceLabel(ua) {
  if (!ua) return "未知设备";
  const s = String(ua);
  let browser = "未知浏览器";
  if (/MicroMessenger/i.test(s)) browser = "微信内置";
  else if (/Edg\//.test(s)) browser = "Edge";
  else if (/Chrome\//.test(s)) browser = "Chrome";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  else if (/Safari\//.test(s) && !/Chrome\//.test(s)) browser = "Safari";
  let os = "未知系统";
  if (/Windows NT/.test(s)) os = "Windows";
  else if (/iPhone|iPad/.test(s)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/Android/.test(s)) os = "Android";
  else if (/Linux/.test(s)) os = "Linux";
  return `${browser} on ${os}`;
}

// CF-Connecting-IP 优先, 否则 X-Forwarded-For 第一段, 否则 null
// 安全: 这个 IP 是上游告诉我们的, 真实与否取决于代理链 (CF 一般可信)
function extractIp(req) {
  const headers = req.headers || {};
  const cf = headers["cf-connecting-ip"];
  if (cf) return String(cf).split(",")[0].trim();
  const xff = headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return null;
}

// IP 第一段 (xx.xx.xx.xx → xx.xx.xx.*), 仅用于审计脱敏
function maskIp(ip) {
  if (!ip) return null;
  const parts = String(ip).split(".");
  if (parts.length !== 4) return String(ip).slice(0, 8) + "*";
  return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
}

// 登录/refresh 成功后调用 —— 失败不影响主流程, 只 warn
async function recordSession({ userId, refreshToken, accessToken, req }) {
  try {
    const ua = req?.headers?.["user-agent"] || null;
    const ip = maskIp(extractIp(req));
    const fingerprint = sessionFingerprint(accessToken);
    if (fingerprint) {
      const { data: existing, error: readError } = await getAdmin().from("auth_sessions").select("id,revoked_at")
        .eq("user_id", userId).eq("refresh_token_hash", fingerprint).limit(20);
      if (readError) throw readError;
      if (existing?.some(row => row.revoked_at)) return;
      const value = { device_label: parseDeviceLabel(ua), user_agent: ua ? String(ua).slice(0,500) : null,
        ip, last_active_at: new Date().toISOString() };
      if (existing?.length) {
        await restPatch("auth_sessions", `user_id=eq.${userId}&refresh_token_hash=eq.${encodeURIComponent(fingerprint)}&revoked_at=is.null`, value);
      } else {
        await restInsert("auth_sessions", { user_id:userId,refresh_token_hash:fingerprint,...value });
      }
      return;
    }
    const { error } = await getAdmin()
      .from("auth_sessions")
      .insert({
        user_id: userId,
        refresh_token_hash: hashRefreshToken(refreshToken),
        device_label: parseDeviceLabel(ua),
        user_agent: ua ? String(ua).slice(0, 500) : null,
        ip,
      });
    if (error) {
      warn("auth_session_insert_failed", { userId, err: error.message, code: error.code });
      return;
    }
  } catch (e) {
    warn("auth_session_record_failed", { userId, err: e && e.message });
  }
}

// 用户自己查看自己的活跃设备列表
// 失败要抛, 不能静默吞 (空列表会让人误以为「没设备在登录」, 实际是表没建)
async function listMySessions(userId, accessToken) {
  const { data, error } = await getAdmin()
    .from("auth_sessions")
    .select("id, device_label, ip, created_at, last_active_at, revoked_at, refresh_token_hash")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("last_active_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const current = sessionFingerprint(accessToken);
  return (data ?? []).map(({ refresh_token_hash, ...row }) => ({ ...row,
    is_current: !!current && refresh_token_hash === current,
    legacy: !String(refresh_token_hash || "").startsWith("session:"),
  }));
}

// 用户自己 / 管理员 标记某 session 为已撤销
// 新版用稳定 session_id 的指纹阻止本站访问与续签；旧记录阻止对应刷新令牌续签。
//
// ⚠️ 必须走 lib/rest.js 的 raw PostgREST：supabase-js 的 .update() 在 Cloudflare Workers 上
// 会**静默 no-op**（看着成功、数据没变），那会让「远程登出」点了没反应、设备实际仍在线。
// 曾用 .update()，且 test/routeHygiene.test.js 只扫 routes/ 没覆盖 lib/，长期没被抓到。
// 现在守卫范围已扩到 lib/。
async function revokeSession(userId, sessionId) {
  const { data: target, error } = await getAdmin().from("auth_sessions").select("refresh_token_hash")
    .eq("id", sessionId).eq("user_id", userId).limit(1);
  if (error) throw error;
  if (!target?.length) return 0;
  const fingerprint = target[0].refresh_token_hash;
  const rows = await restPatch(
    "auth_sessions",
    // revoked_at 为空的才更新（幂等：重复点不会报错，但也不会重复写）
    `${String(fingerprint).startsWith("session:") ? `refresh_token_hash=eq.${encodeURIComponent(fingerprint)}` : `id=eq.${sessionId}`}&user_id=eq.${userId}&revoked_at=is.null`,
    { revoked_at: new Date().toISOString() },
  );
  // 返回实际更新的行数，让调用方能判断是否真的生效（0 = 该 session 已撤销或不属于该用户）
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = {
  sessionFingerprint,
  assertSessionActive,
  assertRefreshActive,
  hashRefreshToken,
  parseDeviceLabel,
  extractIp,
  maskIp,
  recordSession,
  listMySessions,
  revokeSession,
};
