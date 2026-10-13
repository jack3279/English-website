// 回归守卫: getAdmin() 必须按凭据签名缓存 —— 换 URL / 换密钥后必须重建客户端。
// 背景: Cloudflare isolate 会跨 secret 变更长期复用, 若只缓存实例, Worker 会一直握着
// 已失效的旧密钥。生产上的表现是: 接口 200 但 teachers/branches 返回空数组
// (旧密钥是 anon 级, 被 RLS 过滤), 而换 secret、重新部署全部"看起来无效"。
// 这类回归无法靠行为断言发现, 只能在单测里直接锁定「实例是否被重建」。
//
// ⚠️ test/setup.js 会通过 -r 预加载并把 lib/supabase.js 换成 mock,
// 所以这里必须先清掉 require cache 才能拿到真实实现。
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const modulePath = path.resolve(__dirname, "..", "lib", "supabase.js");
delete require.cache[modulePath];

const { getAdmin } = require("../lib/supabase.js");
const { mockClient } = require("./mockSupabase.js");

function setEnv(url, key) {
  globalThis.__CLOUDFLARE_ENV = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
}

test.afterEach(() => {
  delete globalThis.__CLOUDFLARE_ENV;
});

test("前置检查: 拿到的是真实 lib/supabase.js, 而不是测试 mock", () => {
  setEnv("https://proj-a.supabase.co", "key-1");
  assert.notEqual(getAdmin(), mockClient, "必须绕开 test/setup.js 的 mock");
  delete globalThis.__CLOUDFLARE_ENV;
  assert.throws(() => getAdmin(), /required/);
});

test("getAdmin 凭据不变时复用同一实例", () => {
  setEnv("https://proj-a.supabase.co", "key-1");
  const a = getAdmin();
  const b = getAdmin();
  assert.equal(a, b);
});

test("getAdmin 换密钥后必须重建客户端（否则会一直用旧密钥）", () => {
  setEnv("https://proj-a.supabase.co", "key-1");
  const a = getAdmin();
  setEnv("https://proj-a.supabase.co", "key-2");
  const b = getAdmin();
  assert.notEqual(a, b, "换密钥后必须新建客户端");
  assert.equal(getAdmin(), b, "换完之后应稳定复用新实例");
});

test("getAdmin 换项目 URL 后必须重建客户端", () => {
  setEnv("https://proj-a.supabase.co", "key-1");
  const a = getAdmin();
  setEnv("https://proj-b.supabase.co", "key-1");
  const b = getAdmin();
  assert.notEqual(a, b, "换项目后必须新建客户端");
});

test("getAdmin 缺任一凭据时抛错（不返回半配置的客户端）", () => {
  globalThis.__CLOUDFLARE_ENV = { SUPABASE_URL: "https://proj-a.supabase.co" };
  assert.throws(() => getAdmin(), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);

  globalThis.__CLOUDFLARE_ENV = { SUPABASE_SERVICE_ROLE_KEY: "key-1" };
  assert.throws(() => getAdmin(), /required/);
});
