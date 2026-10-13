import {getDataScope} from './dataScope.js';
import {uiError} from "../i18n/store.js";
// API 基址优先级: VITE_API_BASE (Pages/CI 环境变量) > 生产默认 api.17say.org > 本地代理 /api
// 生产默认值兜底: .env.production 被 .gitignore 忽略, 云端构建(Cloudflare Pages)拿不到,
// 若只回落到 "/api" 会把请求打到 17say.org/api 并静默 404, 故显式给出线上 API 域名。
const BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://api.17say.org" : "/api");

import { getToken, getRefreshToken, setAccessToken, clearSession } from "./auth-store.js";

// 单飞: 同一时刻只允许一个 refresh 请求在飞, 其他 401 都 await 同一个 Promise。
// 避免并发请求触发 N 次 refresh 把 refresh_token 用废 (refresh_token 用一次就换新)。
let _refreshInflight = null;

async function refreshTokens() {
  if (_refreshInflight) return _refreshInflight;
  const rt = getRefreshToken();
  if (!rt) throw new Error("no_refresh_token");

  _refreshInflight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok || !data?.data?.access_token) {
        // refresh 也 401 -> 真的过期了, 清掉登录态
        clearSession();
        throw new Error("refresh_failed");
      }
      setAccessToken(data.data.access_token);
      return data.data.access_token;
    } finally {
      _refreshInflight = null;
    }
  })();
  return _refreshInflight;
}

// 哪些请求自动 refresh: 大部分都要, 但 /auth/refresh 和 /auth/login 本身不能
// 套娃 (否则 401 时会无限递归)。
const NO_REFRESH_PREFIXES = [
  "/auth/refresh",
  "/auth/login",
  "/auth/signup",
  "/auth/reset-password",
];

function shouldSkipRefresh(path) {
  return NO_REFRESH_PREFIXES.some((p) => path.startsWith(p));
}

// 单次 http 请求; 401 时自动用 refresh_token 换新 token 再重发原请求。
// 重发一次仍 401 -> 抛错 (此时 refresh_token 也已失效, 上层会清登录态并跳登录页)。
export async function http(path, { method = "GET", body, headers = {} } = {}) {
  const send = (token) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-data-scope":getDataScope(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await send(getToken());
  let text = await res.text();
  let data = text ? JSON.parse(text) : null;

  // 401 + 不是登录/刷新本身 -> 尝试 refresh + 重发
  if (res.status === 401 && !shouldSkipRefresh(path) && getRefreshToken()) {
    try {
      const newToken = await refreshTokens();
      res = await send(newToken);
      text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      // refresh 失败, 用原 401 响应继续走错误分支
    }
  }

  if (!res.ok) {
    // 未勾选记住设备时没有刷新令牌：过期会话必须回到登录页，
    // 否则配置页只会不断显示“加载失败”，家长也无法确认绑定验证码。
    if (res.status === 401 && !shouldSkipRefresh(path) && !getRefreshToken()) clearSession();
    const err = new Error(uiError(data?.error || `HTTP ${res.status}`));
    err.originalMessage=data?.error;
    err.status = res.status;
    err.code = data?.code;
    err.details = data?.details;
    err.reqId = res.headers.get("x-request-id");
    throw err;
  }
  return data;
}
