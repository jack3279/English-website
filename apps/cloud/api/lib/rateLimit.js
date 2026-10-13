// 公开接口限流。
//
// 为什么需要: B 版没有任何限速, 而 POST /leads 是**无需登录**的公开入口。
// 被脚本刷一下就是几千条垃圾线索 —— 线索列表是教务每天要看的, 一脏就得人工清。
// /auth/login 同理, 没限速就等于允许在线撞密码。
//
// 实现选择: 固定窗口 + isolate 内存。Workers 免费档没有 Durable Objects,
// 多实例并存且 isolate 会被回收, 所以这里**不是严格配额**。
//
// ⚠️ 实测结论(2026-09-21, 生产环境连发 16 次登录探测):
//   本站流量低, isolate 常在两次请求之间被回收, 计数器可能每次都从 0 开始 ——
//   10 次/5 分钟的配额实际没被打满过。也就是说:
//     ✅ 能挡住: 脚本在**短时间内连续**狂发(同一个温 isolate 内累计到阈值)
//     ❌ 挡不住: 慢速轮询式刷(每次都落到新 isolate)、换 IP、跨 PoP 分散
//   要真正挡住后者, 得上跨实例存储(KV/DO/R2 计数), 或直接用 Cloudflare 控制台里
//   免费档就有的 Bot Fight Mode / Under Attack Mode(在边缘拦, 比 Worker 里数更靠前)。
//   建议两者都开: 这里是兜底, 边缘防护才是主力。
const { warn } = require("./log.js");

const buckets = new Map(); // "规则名:IP" -> { count, resetAt }
const MAX_KEYS = 5000; // 超限就清一遍过期的, 防止内存无限涨

function sweep(now) {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  // 极端情况下(全是未过期的)再砍掉最早写入的一批, 保证一定有空间
  if (buckets.size >= MAX_KEYS) {
    let toDrop = Math.floor(MAX_KEYS / 4);
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (--toDrop <= 0) break;
    }
  }
}

// 返回 { allowed, remaining, limit, retryAfter }
function hit(key, limit, windowMs) {
  const now = Date.now();
  sweep(now);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, limit, retryAfter: 0 };
  }
  if (cur.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      retryAfter: Math.ceil((cur.resetAt - now) / 1000),
    };
  }
  cur.count += 1;
  return { allowed: true, remaining: limit - cur.count, limit, retryAfter: 0 };
}

// ── 规则表 ──────────────────────────────────────────────────
// path 是**去掉 /api 前缀**后的完整路径(如 /auth/login)。
// 额度放宽一档: 同一家公司/同一个 NAT 出口可能有多位家长同时填报名表。
const RULES = [
  {
    name: "passwordChange", method: "POST", test: (p) => p === "/me/password",
    limit: 5, windowMs: 300_000, message: "密码修改尝试过于频繁，请 5 分钟后再试",
  },
  { name:"adminCreate",method:"POST",test:(p)=>p==="/accounts/admin"||p==="/accounts/password",limit:5,windowMs:300_000,message:"账号操作过于频繁，请稍后重试" },
  {
    name: "leads",
    method: "POST",
    test: (p) => p === "/leads",
    limit: 20,
    windowMs: 3600_000,
    message: "报名提交过于频繁, 请稍后再试",
  },
  {
    name: "login",
    method: "POST",
    test: (p) => p === "/auth/login",
    limit: 10,
    windowMs: 300_000,
    message: "登录尝试过于频繁, 请 5 分钟后再试",
  },
  {
    name: "signup",
    method: "POST",
    test: (p) => p === "/auth/signup",
    limit: 5,
    windowMs: 3600_000,
    message: "注册请求过于频繁, 请稍后再试",
  },
  {
    name: "clientErrors",
    method: "POST",
    test: (p) => p === "/client-errors",
    limit: 60,
    windowMs: 60_000,
    message: "错误上报过于频繁",
  },
];

function fullPath(req) {
  const raw = String(req?._request?.url || req?.url || "");
  if (!raw) return "/";
  if (raw.startsWith("http")) {
    try {
      return new URL(raw).pathname;
    } catch {
      return raw;
    }
  }
  return raw.split("?")[0];
}

// 剥掉 /api 前缀, 与 Vercel rewrites 后的形态对齐
function normalizePath(p) {
  return p.replace(/^\/api/, "") || "/";
}

function clientIp(req) {
  const h = req?.headers || {};
  const xff = String(h["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return h["cf-connecting-ip"] || xff || h["x-real-ip"] || "unknown";
}

function disabled() {
  const env = globalThis.__CLOUDFLARE_ENV || {};
  const fromProc =
    typeof process !== "undefined" && process.env ? process.env.RATE_LIMIT_DISABLED : "";
  return String(env.RATE_LIMIT_DISABLED || fromProc || "") === "1";
}

// 命中规则就返回 { ...结果, rule }, 没命中返回 null
function check(req) {
  if (disabled()) return null;
  const path = normalizePath(fullPath(req));
  const rule = RULES.find((r) => r.method === req.method && r.test(path));
  if (!rule) return null;
  const result = hit(`${rule.name}:${clientIp(req)}`, rule.limit, rule.windowMs);
  if (!result.allowed) {
    warn("rate_limited", { rule: rule.name, ip: clientIp(req), path });
  }
  return { ...result, rule };
}

// 测试用: 清空计数
function reset() {
  buckets.clear();
}

module.exports = { check, reset, RULES, clientIp, fullPath, normalizePath };
