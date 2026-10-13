// 本地 dev server (绕开 vercel cli, 不需要 vercel login)
// 把 Vercel 的 /api/* 路由映射到本地 Node server, 并给 res 加 status/json shim
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const PORT = process.env.PORT || 3001;
const ROUTES_DIR = path.join(__dirname, "routes");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

// 把原生 res 包成 Vercel 风格: res.status(c).json(payload).setHeader(k,v).end()
function wrapRes(res) {
  let status = 200;
  res.status = (c) => {
    status = c;
    res.statusCode = c;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.statusCode = status;
      res.end(JSON.stringify(payload));
    }
    return res;
  };
  return res;
}

// 加载路由 (文件名 -> handler)
const handlers = {};
for (const file of fs.readdirSync(ROUTES_DIR)) {
  if (!file.endsWith(".js")) continue;
  if (file.startsWith("_")) continue;
  const name = file.replace(/\.js$/, "");
  // 例如 routes/auth.js -> /auth (handler 内自己 dispatch req.url 区分 /auth/login vs /auth/logout)
  handlers[`/${name}`] = require(path.join(ROUTES_DIR, file));
}

const middleware = require(path.join(ROUTES_DIR, "_middleware.js"));

http
  .createServer(async (req, res) => {
    // CORS 预检
    res.setHeader(
      "Access-Control-Allow-Origin",
      process.env.CORS_ORIGIN || req.headers.origin || "http://localhost:5174",
    );
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-request-id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    // 解析 body
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      wrapRes(res);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        try {
          req.body = JSON.parse(raw);
        } catch {
          req.body = null;
        }
      } else {
        req.body = null;
      }

      // middleware
      try {
        if (middleware) await middleware(req, res);
      } catch (e) {
        if (!res.headersSent) {
          res.status(e.status || 500).json({ error: "middleware error", code: e.code || "ERROR" });
        }
        return;
      }
      if (res.writableEnded) return;

      // 路由: 取 path 第一段作为文件名, 把 file 段剥掉再传给 handler
      // (Vercel 行为: rewrites /api/foo/bar -> routes/foo.js with req.url = '/foo/bar')
      const url = req.url || "/";
      const qIdx = url.indexOf("?");
      const urlPath = qIdx === -1 ? url : url.slice(0, qIdx);
      const qs = qIdx === -1 ? "" : url.slice(qIdx);
      const stripped = urlPath.replace(/^\/api/, "").replace(/\/$/, "") || "/";
      const parts = stripped.split("/").filter(Boolean);
      const seg = "/" + parts[0];
      const handler = handlers[seg];
      if (!handler) {
        res
          .status(404)
          .json({ error: `not found: ${stripped}`, code: "NOT_FOUND", path: stripped });
        return;
      }
      // 重写 req.url 为去掉 file 段的形式 (与 vercel dev 行为一致)
      req.url = (parts.length > 1 ? "/" + parts.slice(1).join("/") : "/") + qs;
      try {
        await require('./lib/dataScope.js').runRequest(req,res,seg.slice(1),handler);
      } catch (e) {
        if (!res.headersSent) {
          res.status(e.status || 500).json({
            error: e.status >= 500 ? "服务器错误" : e.message,
            code: e.code || "ERROR",
          });
        }
      }
    });
  })
  .listen(PORT, () => {
    console.log(`[api] listening on http://127.0.0.1:${PORT}`);
    console.log(`  supabase: ${SUPABASE_URL}`);
    console.log("  routes:");
    for (const k of Object.keys(handlers)) console.log(`    ${k}`);
  });
