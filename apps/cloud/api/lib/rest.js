// raw PostgREST 通道。
// 背景: supabase-js 的 .update()/.delete() 在 Cloudflare Workers 里会静默 no-op,
// 所有写操作必须直接 fetch PostgREST (service_role 绕过 RLS)。
// 附带好处: 一次 PATCH 可以带 filter 批量更新, 省子请求 (免费档 50 子请求/请求)。

function currentEnv() {
  return globalThis.__CLOUDFLARE_ENV || process.env;
}

function baseUrl(table) {
  const env = currentEnv();
  return `${String(env.SUPABASE_URL || "").replace(/\/$/, "")}/rest/v1/${table}`;
}

function headers(prefer) {
  const env = currentEnv();
  return {
    "content-type": "application/json",
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function buildFilter(filter) {
  if (typeof filter === "string") return filter;
  // { id: uuid, status: 'pending' } -> "id=eq.x&status=eq.pending"
  return Object.entries(filter)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`)
    .join("&");
}

async function restPatch(table, filter, patch, prefer = "return=representation") {
  const scope=require('./dataScope.js');patch=scope.prepareRows(table,patch,false);await scope.guardRows(table,patch);
  const r = await fetch(`${baseUrl(table)}?${scope.queryString(table,buildFilter(filter))}`, {
    method: "PATCH",
    headers: headers(prefer),
    body: JSON.stringify(patch),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rest PATCH ${table} failed: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function restDelete(table, filter, prefer = "return=representation") {
  const r = await fetch(`${baseUrl(table)}?${require('./dataScope.js').queryString(table,buildFilter(filter))}`, {
    method: "DELETE",
    headers: headers(prefer),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rest DELETE ${table} failed: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function restInsert(table, rows, prefer = "return=representation") {
  const scope=require('./dataScope.js');rows=scope.prepareRows(table,rows);await scope.guardRows(table,rows);if(prefer.includes('merge-duplicates'))await scope.guardExisting(table,rows);
  const list = Array.isArray(rows) ? rows : [rows];
  const r = await fetch(baseUrl(table), {
    method: "POST",
    headers: headers(prefer),
    body: JSON.stringify(list),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rest INSERT ${table} failed: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

module.exports = { restPatch, restInsert, restDelete, baseUrl, headers };
