import adminBot from "../routes/adminBot.js";
import renewals from "../routes/renewals.js";
import teacherAvailability from "../routes/teacherAvailability.js";
import dataScope from "../lib/dataScope.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import assistants from "../lib/adminBot.js";
export class AdminBotRunner extends WorkerEntrypoint {
  async tick(userId) {
    globalThis.__CLOUDFLARE_ENV = this.env;
    const {getUnscopedAdmin}=await import('../lib/supabase.js');
    const {data,error}=await getUnscopedAdmin().from('profiles').select('is_test').eq('id',userId).maybeSingle();
    if(error||!data)throw new Error('Assistant owner unavailable');
    return dataScope.runSystem(data.is_test?'test':'production',async()=> (await assistants.forUser(userId)).tick());
  }
}
// Cloudflare Workers entry
import { withErrorHandler } from "../lib/errors.js";
import auth from "../routes/auth.js";
import me from "../routes/me.js";
import branches from "../routes/branches.js";
import teachers from "../routes/teachers.js";
import students from "../routes/students.js";
import schedules from "../routes/schedules.js";
import courses from "../routes/courses.js";
import importRows from "../routes/importRows.js";
import lessons from "../routes/lessons.js";
import parent from "../routes/parent.js";
import alerts from "../routes/alerts.js";
import leads from "../routes/leads.js";
import packages from "../routes/packages.js";
import messages from "../routes/messages.js";
import notifications from "../routes/notifications.js";
import announcements from "../routes/announcements.js";
import materials from "../routes/materials.js";
import leave from "../routes/leave.js";
import reports from "../routes/reports.js";
import operations from "../routes/operations.js";
import backups from "../routes/backups.js";
import makeups from "../routes/makeups.js";
import audit from "../routes/audit.js";
import finance from "../routes/finance.js";
import clientErrors from "../routes/clientErrors.js";
import health from "../routes/health.js";
import migrations from "../routes/migrations.js";
import middleware from "../routes/_middleware.js";
import accounts from "../routes/accounts.js";
import families from "../routes/families.js";
import institutionSettings from "../routes/institutionSettings.js";

const handlers = {
  "/teacher-availability": teacherAvailability,
  "/renewals": renewals,
  "/admin-bot": adminBot,
  "/accounts": accounts,
  "/families": families,
  "/institution-settings": institutionSettings,
  "/auth": auth,
  "/me": me,
  "/branches": branches,
  "/teachers": teachers,
  "/students": students,
  "/schedules": schedules,
  "/courses": courses,
  "/lessons": lessons,
  "/parent": parent,
  "/alerts": alerts,
  "/leads": leads,
  "/packages": packages,
  "/messages": messages,
  "/notifications": notifications,
  "/leave": leave,
  "/reports": reports,
  "/operations": operations,
  "/backups": backups,
  "/announcements": announcements,
  "/materials": materials,
  "/makeups": makeups,
  "/audit": audit,
  "/finance": finance,
  "/client-errors": clientErrors,
  "/import-rows": importRows,
  "/health": health,
  "/admin-migrations": migrations,
};

// URL 层统一 kebab-case：把 camelCase 段名归一化为 kebab-case，避免路由漏配。
function toKebab(seg) {
  return seg.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// CORS：只回显白名单内的 Origin，拒绝任意来源与 null。
function allowedOrigins(env) {
  return String(env?.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allow = allowedOrigins(env);
  // 只有在白名单内才回显该 Origin；否则回退第一个白名单项（浏览器会自行拒绝不匹配的跨域）。
  const allowOrigin = allow.includes(origin) ? origin : allow[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id, x-data-scope",
    "Access-Control-Max-Age": "86400",
  };
}

function makeRes(request, env) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  let status = 200;
  let body = null;
  // 原来恒为 false, 导致中间件(限流/预检)根本无法提前结束请求 —— 429 会被继续
  // 丢给业务 handler 覆盖掉。改成真实标记, 中间件才能真正短路。
  let ended = false;
  return {
    setHeader(k, v) {
      headers.set(k, v);
    },
    status(c) {
      status = c;
      return this;
    },
    statusCode: status,
    json(p) {
      body = p;
      ended = true;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
    get writableEnded() {
      return ended;
    },
    headersSent: false,
    async toResponse() {
      return new Response(body !== null ? JSON.stringify(body) : null, { status, headers });
    },
  };
}

import { runScheduled } from "./scheduled.js";

export default {
  // Cron 定时任务入口 (保活/提醒/备份), 任务必须幂等
  async scheduled(event, env, ctx) {
    try {
      const result = await dataScope.runSystem(event.cron === '30 18 * * *' ? 'all' : 'production',()=>runScheduled(event, env));
      console.log(`[cron:${event.cron}]`, JSON.stringify(result));
    } catch (e) {
      console.error(`[cron:${event.cron}] failed`, e?.message || e);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Workers secrets 通过 env 参数传, 不是 process.env. 把 env 存到 globalThis 给 lib/supabase.js 读
    globalThis.__CLOUDFLARE_ENV = env;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    // 归一化：URL 段统一转 kebab-case，兼容调用方书写 camelCase / kebab-case。
    const rawSeg = parts[0] || "";
    let seg = "/" + toKebab(rawSeg);
    if (seg === "/admin" && parts[1]) {
      const sub = toKebab(parts[1]);
      if (sub === "alerts") seg = "/alerts";
      if (sub === "seed-demo") seg = "/seed-demo";
      if (sub === "import-rows") seg = "/import-rows";
    }
    const handler = handlers[seg];
    if (!handler) {
      return new Response(
        JSON.stringify({ error: "not found", code: "NOT_FOUND", path: url.pathname }),
        {
          status: 404,
          headers: { "content-type": "application/json", ...corsHeaders(request, env) },
        },
      );
    }

    const req = {
      url: (parts.length > 1 ? "/" + parts.slice(1).join("/") : "/") + url.search,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      _request: request,
      context: { supabase: env },
      body: null,
    };

    // Parse JSON body for POST/PATCH/PUT
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      try {
        const raw = await request.text();
        if (raw) {
          try {
            req.body = JSON.parse(raw);
          } catch {
            req.body = raw; // keep as string, route may parse
          }
        }
      } catch (e) {
        // ignore body read errors, route will handle missing body
      }
    }

    // 中间件和业务 handler 必须共用同一个 res。
    // 原来各建一个, 中间件写的头(x-request-id / x-ratelimit-* / 限流的 429)全被丢掉 ——
    // 只有短路返回的那条路径生效, 正常请求的响应里根本看不到 reqId, 排障时无从对照日志。
    const res = makeRes(request, env);
    if (middleware) {
      try {
        await middleware(req, res);
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "middleware error", code: e.code || "ERROR" }),
          {
            status: 500,
            headers: { "content-type": "application/json", ...corsHeaders(request, env) },
          },
        );
      }
      // 被限流 / 预检: 中间件已写完整响应, 直接返回
      if (res.writableEnded) return res.toResponse();
    }

    try {
      const wrapped = withErrorHandler((req,res)=>dataScope.runRequest(req,res,seg.slice(1),handler));
      await wrapped(req, res);
    } catch (e) {
      if (!res.headersSent) {
        const status = e.status || 500;
        return new Response(
          JSON.stringify({
            error: status >= 500 ? "服务器错误" : e.message,
            code: e.code || "ERROR",
            // 5xx 必须带 reqId：客户端只有靠它才能与日志/x-request-id 对齐做排障
            ...(status >= 500 ? { reqId: req.reqId ?? null } : {}),
          }),
          {
            status,
            headers: { "content-type": "application/json", ...corsHeaders(request, env) },
          },
        );
      }
    }
    return res.toResponse();
  },
};
