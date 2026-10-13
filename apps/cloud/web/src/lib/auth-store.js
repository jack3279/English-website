// 模块级登录态存储 —— 跨 useAuth 多实例、跨 http() 调用共享同一份 token。
// 改造原因: http() 内部需要"读 token + 401 后刷新 + 写新 token", 这要求 token
// 在模块作用域可见 (而不是只藏在某个 React 实例的 state 里)。
//
// 持久层选 localStorage 而不是 sessionStorage: Supabase refresh_token 默认
// 30 天有效, 用户期望「记住此设备」能在多次开关浏览器后仍保持登录。
// 「记住此设备」选项的开关, 由上层 useAuth 在登录/登出时控制 (refresh_token
// 是写 localStorage 还是清掉)。

const TOKEN_KEY = "cloud_jwt";
const REFRESH_KEY = "cloud_refresh_token";
const USER_KEY = "cloud_user";
const USER_ID_KEY = "cloud_user_id";
const LAST_EMAIL_KEY = "cloud_last_email"; // 仅用于「上次登录的账号」预填, 不存密码

// 模块内 in-memory 缓存, 避免每次都从 localStorage 读 (快很多)
let _memToken = null;
let _memRefreshToken = null;
let _memUser = null;
let _initialized = false;

// 初始化: 从 localStorage 读一次, 之后只在 set/clear 时写回
function ensureInit() {
  if (_initialized) return;
  _initialized = true;
  try {
    _memToken = localStorage.getItem(TOKEN_KEY) || null;
    _memRefreshToken = localStorage.getItem(REFRESH_KEY) || null;
    const u = localStorage.getItem(USER_KEY);
    _memUser = u ? JSON.parse(u) : null;
  } catch (_) {
    _memToken = _memRefreshToken = _memUser = null;
  }
  // 跨 tab 同步: 同一浏览器其他 tab 改了登录态, 这里要跟上
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (!e.key) return;
      if (e.key === TOKEN_KEY) _memToken = e.newValue;
      else if (e.key === REFRESH_KEY) _memRefreshToken = e.newValue;
      else if (e.key === USER_KEY) {
        try {
          _memUser = e.newValue ? JSON.parse(e.newValue) : null;
        } catch (_) {
          _memUser = null;
        }
      }
      // 通知组件刷新
      window.dispatchEvent(new CustomEvent("auth:changed"));
    });
  }
}

export function getToken() {
  ensureInit();
  return _memToken;
}

export function getRefreshToken() {
  ensureInit();
  return _memRefreshToken;
}

export function getUser() {
  ensureInit();
  return _memUser;
}

export function getLastEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || "";
  } catch (_) {
    return "";
  }
}

// 写入完整登录态 (login 成功后调用)
export function setSession({ access_token, refresh_token, user }) {
  ensureInit();
  _memToken = access_token || null;
  _memRefreshToken = refresh_token || null;
  if (user) {
    _memUser = user;
  }
  try {
    if (_memToken) localStorage.setItem(TOKEN_KEY, _memToken);
    if (_memRefreshToken) localStorage.setItem(REFRESH_KEY, _memRefreshToken);
    else localStorage.removeItem(REFRESH_KEY);
    if (_memUser) {
      localStorage.setItem(USER_KEY, JSON.stringify(_memUser));
      if (_memUser.id) localStorage.setItem(USER_ID_KEY, _memUser.id);
    }
  } catch (_) {
    /* localStorage 可能被禁用, 降级为内存模式 (刷新页面失效) */
  }
  notify();
}

// 只刷 access_token (refresh 后调用), 不动 refresh_token 和 user
export function setAccessToken(access_token) {
  ensureInit();
  _memToken = access_token;
  try {
    if (access_token) localStorage.setItem(TOKEN_KEY, access_token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {
    /* ignore */
  }
  notify();
}

// 仅记录上次登录的 email (供登录页预填)
export function setLastEmail(email) {
  try {
    if (email) localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch (_) {
    /* ignore */
  }
}

export function clearSession() {
  ensureInit();
  _memToken = null;
  _memRefreshToken = null;
  _memUser = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_ID_KEY);
  } catch (_) {
    /* ignore */
  }
  notify();
}

function notify() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth:changed"));
  }
}
