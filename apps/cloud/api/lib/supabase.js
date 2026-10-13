// 在 Cloudflare Workers 里, secrets 通过 fetch 的 env 参数传, 不在 process.env
// 所以用 globalThis 保存 (也兼容 dev server)
const { createClient } = require("@supabase/supabase-js");

// ⚠️ 客户端必须按「凭据签名」缓存, 不能只缓存实例。
// isolate 会跨 secret 变更长期复用, 只按实例缓存会让 Worker 一直握着旧密钥:
// 表现是接口返回 200 但数据为空 (RLS 生效后按 anon 角色过滤)、写操作不生效,
// 而且换 secret、重新部署都"看起来没用"—— 排查成本极高, 已在生产上真实踩到。
let _admin = null;
let _adminSig = null;

function currentEnv() {
  return globalThis.__CLOUDFLARE_ENV || process.env;
}

function getUnscopedAdmin() {
  const env = currentEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const sig = `${url}::${key}`;
  if (_admin && _adminSig === sig) return _admin;
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  _adminSig = sig;
  return _admin;
}
function getAdmin(){const db=getUnscopedAdmin();return require('./dataScope.js').current()?require('./dataScope.js').client(db):db;}

// 登录 / 注册等「会把 session 写进客户端实例」的 auth 调用, 必须用一次性客户端。
// supabase-js 的 signInWithPassword / signUp 会把登录结果保存到实例上, 之后该实例发出的
// PostgREST 请求会携带「用户 JWT」而不是 service_role key。共享的 admin 客户端一旦被这样
// 污染, 之后所有读写都会退化成普通用户身份 (RLS 生效)—— 表现是接口 200 但数据变空,
// 且随请求命中的 isolate 而抖动 (命中已被污染的 isolate 就空, 命中全新 isolate 就正常)。
function createAuthClient() {
  const env = currentEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// 每次调用都新建: 它带的是用户 JWT, 不能跨请求复用。
function getUserClient(jwt) {
  const env = currentEnv();
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

module.exports = { getAdmin, getUnscopedAdmin, getUserClient, createAuthClient };
