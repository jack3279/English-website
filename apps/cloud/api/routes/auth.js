const { z } = require("zod");
const { getAdmin, createAuthClient } = require("../lib/supabase.js");
const { ok, badRequest, unauthorized, forbidden } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const { record: audit } = require("../lib/audit.js");
const { warn } = require("../lib/log.js");
const { recordSession, assertSessionActive, assertRefreshActive } = require("../lib/sessions.js");

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function login(req, res) {
  // Worker env: 直接从 _request 读 raw body, 用正则宽松解析
  // 兼容 JSON / form-data / 各种 shell 转义怪异
  let email = null,
    password = null;

  const tryParse = (raw) => {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        if (obj.email) email = String(obj.email).trim();
        if (obj.password) password = String(obj.password);
      }
    } catch (_) {
      /* not JSON */
    }
    if (!email) {
      const m = raw.match(/(?:^|[,{\s])["']?email["']?\s*:\s*["']?([^"',}\s]+)["']?/i);
      if (m) email = m[1].trim();
    }
    if (!password) {
      const m = raw.match(/(?:^|[,{\s])["']?password["']?\s*:\s*["']?([^"',}\s]+)["']?/i);
      if (m) password = m[1];
    }
  };

  let raw = null;
  if (req.body) {
    raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else if (req._request) {
    try {
      raw = await req._request.text();
    } catch (_) {
      raw = null;
    }
  }
  if (raw) tryParse(raw);

  const parsed = LoginInput.safeParse({ email, password });
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  email = parsed.data.email;
  password = parsed.data.password;

  if (!email || !password) {
    badRequest(res, "参数不合法", {
      formErrors: ["email 和 password 必填"],
      fieldErrors: { email: ["缺失"], password: ["缺失"] },
    });
    return;
  }
  // ⚠️ 必须用一次性客户端: signInWithPassword 会把 session 写进实例,
  // 若挂在共享的 getAdmin() 上, 之后所有请求都会变成「用户身份」而非 service_role (RLS 生效)。
  const authClient = createAuthClient();
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    // 只记「登录失败」这个事实, 不记 email —— 日志是运维可见的,
    // 失败的邮箱列表本身就是撞库成果, 不该留在生产日志里。
    warn("login_failed", { reqId: req.reqId });
    unauthorized(res, "邮箱或密码错误");
    return;
  }
  const token = data.session?.access_token;
  if (!token) {
    unauthorized(res, "登录失败：无 token");
    return;
  }
  await audit(data.user.id, "auth.login", "user", data.user.id, null, req.reqId);
  // 多设备追踪 —— 失败不影响主流程, 只 warn
  await recordSession({
    userId: data.user.id,
    refreshToken: data.session.refresh_token,
    accessToken: token,
    req,
  });
  ok(res, {
    access_token: token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    password_change_recommended: password === "Demo1234!",
    user: { id: data.user.id, email: data.user.email },
  });
}

function logout(req, res) {
  ok(res, { logged_out: true });
}

async function signup(_req, res) {
  // 公开注册会直接变成家长账号。正式运营前关掉，账号由管理员开通。
  forbidden(res, "已关闭公开注册，请联系管理员开通账号");
}

async function resetPassword(req, res) {
  let body = req.body;
  if (!body && req._request) {
    try {
      body = JSON.parse(await req._request.text());
    } catch (_) {
      body = {};
    }
  }
  const ResetInput = z.object({ email: z.string().email() });
  const parsed = ResetInput.safeParse(body || {});
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  // 邮箱恢复尚未配置完整的验证和落地页。绝不能向匿名请求者返回登录凭据。
  throw new HttpError(409, "SELF_RESET_UNAVAILABLE", "请联系教务核实身份后恢复账号。已登录用户可在账号设置中修改密码");
}

// 用 refresh_token 换新 access_token + 新 refresh_token。
// Supabase 默认 access_token 1 小时过期, refresh_token 30 天。
// 配合前端 "记住此设备" 选项, 实现 30 天免输密码。
//
// 注意: refresh_token 一次性的, 用完必须换新的。失败 (401/400) 表示已登出,
// 此时前端必须清空本地登录态, 跳回登录页。
async function refresh(req, res) {
  let body = req.body || {};
  if (!body && req._request) {
    try {
      body = JSON.parse(await req._request.text());
    } catch (_) {
      body = {};
    }
  }
  const refresh_token = String(body.refresh_token || "").trim();
  if (!refresh_token) {
    badRequest(res, "缺少 refresh_token");
    return;
  }
  await assertRefreshActive(refresh_token);
  // 一次性客户端, 不污染 admin 实例 (见 login)
  const authClient = createAuthClient();
  const { data, error } = await authClient.auth.refreshSession({ refresh_token });
  if (error || !data?.session) {
    unauthorized(res, "refresh_token 已过期或无效, 请重新登录");
    return;
  }
  await assertSessionActive(data.user.id, data.session.access_token);
  // 续签也算一次"使用 session" —— 记录最新活动设备
  await recordSession({
    userId: data.user.id,
    refreshToken: data.session.refresh_token,
    accessToken: data.session.access_token,
    req,
  });
  ok(res, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    user: { id: data.user?.id, email: data.user?.email },
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/login") return login(req, res);
  if (req.method === "POST" && url.pathname === "/logout") return logout(req, res);
  if (req.method === "POST" && url.pathname === "/signup") return signup(req, res);
  if (req.method === "POST" && url.pathname === "/reset-password") return resetPassword(req, res);
  if (req.method === "POST" && url.pathname === "/refresh") return refresh(req, res);
  throw new HttpError(404, "NOT_FOUND", "unknown auth route");
};
