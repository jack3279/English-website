// 临时截图脚本: 抓线上真实界面用于"改前 / 改后"对照。
//
// 不走登录表单 —— 表单时序在慢网络下不可靠(第一次跑出来 8 张图完全一样, 全是登录页)。
// 改成先调 API 拿 token, 再用 addInitScript 直接写进 localStorage: 稳定且快。
//
// 用法: node shot-ui.mjs <输出目录> [只抓这些页,逗号分隔]
//   例: node shot-ui.mjs E:/tmp/ui-after admin-home,students
// 口令默认用演示账号的（见 docs/初始化线上演示数据.md），可用 SHOT_PASSWORD 覆盖。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = process.argv[2] || "E:/tmp/ui-shots";
const ONLY = process.argv[3] ? process.argv[3].split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

const SITE = "https://17say.org";
const API = "https://api.17say.org";
const PASSWORD = process.env.SHOT_PASSWORD || "Demo1234!";

const SHOTS = [
  ["login", "/login", null, null],
  ["admin-home", "/admin", "admin@17say.org", null],
  ["students", "/students", "admin@17say.org", null],
  ["finance", "/admin/finance", "admin@17say.org", null],
  ["operations", "/admin/operations", "admin@17say.org", null],
  ["teacher-today", "/teacher/today", "emma@17say.org", null],
  ["teacher-payroll", "/teacher/payroll", "emma@17say.org", null],
  ["parent-h5", "/parent", "lilyparent@17say.org", { width: 430, height: 900 }],
];

async function auth(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  const token = j?.data?.access_token;
  if (!token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
  // ⚠️ 登录返回的 user 只有 {id,email}, **没有 role** —— 前端是登录后再调 /me 拿角色。
  // 所以注入的 cloud_user 必须是 /me 的结果, 否则 RoleGuard 会判成无权访问。
  const me = await (
    await fetch(`${API}/me`, { headers: { authorization: `Bearer ${token}` } })
  ).json();
  return { token, user: me.data };
}

const sessions = {};
const browser = await chromium.launch();

for (const [name, path, email, viewport] of SHOTS) {
  if (ONLY && !ONLY.includes(name)) continue;
  try {
    let ctx;
    if (!email) {
      ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    } else {
      if (!sessions[email]) sessions[email] = await auth(email);
      const s = sessions[email];
      ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
      await ctx.addInitScript(
        ([t, u]) => {
          globalThis.localStorage.setItem("cloud_jwt", t);
          globalThis.localStorage.setItem("cloud_user", u);
          globalThis.localStorage.setItem("cloud_user_id", JSON.parse(u).id);
        },
        [s.token, JSON.stringify(s.user)],
      );
    }
    const page = await ctx.newPage();
    await page.goto(`${SITE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500); // 等 react-query 数据渲染
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`OK   ${name.padEnd(16)} ${path}`);
    await ctx.close();
  } catch (e) {
    console.log(`FAIL ${name.padEnd(16)} ${path}  -> ${e.message.split("\n")[0]}`);
  }
}

await browser.close();
console.log("done ->", OUT);
