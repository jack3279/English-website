const crypto = require("node:crypto");
const { info } = require("../lib/log.js");
const rateLimit = require("../lib/rateLimit.js");

// CORS：只回显白名单内的 Origin，拒绝任意来源与 null。
function resolveAllowOrigin(origin) {
  const allow = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return "";
  return allow.includes(origin) ? origin : allow[0];
}

module.exports = async function middleware(req, res) {
  req.reqId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("x-request-id", req.reqId);

  const origin = req.headers["origin"] || "";
  const allowOrigin = resolveAllowOrigin(origin);
  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-request-id, x-data-scope");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // 公开接口限流 (POST /leads 无需登录, /auth/login 可被撞密码)
  // 放在鉴权之前: 被限掉的请求根本不该走到数据库。
  const rl = rateLimit.check(req);
  if (rl) {
    res.setHeader("x-ratelimit-limit", String(rl.limit));
    res.setHeader("x-ratelimit-remaining", String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader("retry-after", String(rl.retryAfter));
      res.status(429).json({ error: rl.rule.message, code: "RATE_LIMITED" });
      return;
    }
  }

  info("request_in", {
    reqId: req.reqId,
    method: req.method,
    path: req.url?.replace(/\/callback\/[a-f0-9]{64}/g, "/callback/[redacted]"),
  });
};
