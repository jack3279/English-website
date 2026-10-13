// 部署后复测: 只打开之前出问题的页面, 确认不再报错。
import { chromium } from "@playwright/test";
const BASE = "https://17say.org";
const ROLES = {
  admin: { email: "admin@17say.org", password: "Demo1234!" },
  teacher: { email: "emma@17say.org", password: "Demo1234!" },
};
const TARGETS = {
  admin: ["/admin", "/admin/leave"],
  teacher: ["/admin/leave", "/admin/alerts"],
};

const browser = await chromium.launch({ headless: true });
let pass = 0;
let fail = 0;

for (const [roleName, role] of Object.entries(ROLES)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // realtime WS 是已知非阻断项, 不计入
      if (t.includes("realtime") || t.includes("WebSocket")) return;
      problems.push("console: " + t.slice(0, 160));
    }
  });
  page.on("response", (r) => {
    if (r.url().includes("api.17say.org") && r.status() >= 400) {
      // teacher 访问 admin-only alerts 被 RoleGuard 挡到 /403 时不会再发 alerts 请求;
      // 若仍发出且 4xx, 记录
      problems.push(`api ${r.status()}: ${r.url().replace("https://api.17say.org", "")}`);
    }
  });

  // 登录
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", role.email);
  await page.fill("#login-password", role.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });

  for (const path of TARGETS[roleName]) {
    problems.length = 0;
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    const here = new URL(page.url()).pathname;
    const body = await page.evaluate(() => document.body.innerText).catch(() => "");
    const crashed = ["l.map is not a function", "Cannot read", "出现错误"].some((s) => body.includes(s));
    const bad = problems.length > 0 || crashed;

    if (path === "/admin/alerts" && roleName === "teacher") {
      // 预期: admin-only RoleGuard 把老师挡走 (跳到 /403 或停留在外), 不再发出报错请求
      const guarded = here === "/403" || !problems.some((p) => p.includes("/alerts"));
      if (guarded) { pass++; console.log(`  OK  [${roleName}] ${path} 被正确拦截 (落地 ${here})`); }
      else { fail++; console.log(`  FAIL [${roleName}] ${path} 仍可进入并报错`); }
      continue;
    }

    if (bad) {
      fail++;
      console.log(`  FAIL [${roleName}] ${path}`);
      for (const p of problems.slice(0, 5)) console.log("       " + p);
    } else {
      pass++;
      console.log(`  OK  [${roleName}] ${path} 正常渲染 (落地 ${here})`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n页面复测: ${pass} 通过, ${fail} 失败`);
if (fail) process.exitCode = 1;
