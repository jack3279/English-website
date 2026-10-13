// 回归守卫: 会「把 session 写进客户端实例」的 auth 调用, 绝不能挂在共享的 getAdmin() 上。
//
// 背景（生产真实踩到, 排查了很久）:
//   supabase-js 的 signInWithPassword / signUp / setSession 会把登录结果保存到客户端实例上,
//   之后该实例发出的 PostgREST 请求会携带「用户 JWT」而不是 service_role key。
//   共享的 getAdmin() 一旦被这样污染, 之后所有读写都会退化成普通用户身份 → RLS 生效 →
//   接口返回 200 但数据为空 (teachers / branches 最先暴露), 而且随请求命中哪个 isolate 抖动
//   （全新 isolate 正常、被污染的 isolate 为空），看起来像"网络问题"或"密钥错了"。
// 修法: 这类调用一律改用 createAuthClient() 返回的一次性客户端。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const SESSION_WRITER =
  /\.auth\s*\.\s*(signInWithPassword|signUp|setSession|refreshSession|verifyOtp)\s*\(/;

test("会写入会话的 auth 调用只能出现在一次性客户端(authClient)上", () => {
  const files = [...jsFiles(path.join(ROOT, "routes")), ...jsFiles(path.join(ROOT, "lib"))];
  const offenders = [];

  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    fs.readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!SESSION_WRITER.test(line)) return;
        if (line.includes("authClient")) return; // 合规：一次性客户端
        if (/^\s*(\/\/|\*)/.test(line)) return; // 注释
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
  }

  assert.deepEqual(offenders, [], "这些位置在用共享客户端做会写入会话的调用，会污染整个 Worker");
});

test("createAuthClient 每次返回新实例, 且不与共享 admin 客户端相同", () => {
  const modulePath = path.resolve(ROOT, "lib", "supabase.js");
  delete require.cache[modulePath]; // 绕开 test/setup.js 的 mock
  const { getAdmin, createAuthClient } = require("../lib/supabase.js");

  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj-a.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key-1",
  };

  const a = createAuthClient();
  const b = createAuthClient();
  assert.notEqual(a, b, "登录用的客户端必须是一次性的，不能复用");
  assert.notEqual(a, getAdmin(), "不得与共享 admin 客户端相同");
  assert.equal(getAdmin(), getAdmin(), "共享客户端自身仍应复用");

  delete globalThis.__CLOUDFLARE_ENV;
});
