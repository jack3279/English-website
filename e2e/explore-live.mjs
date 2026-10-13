// 线上 UI 探测: 用三个演示角色登录 https://17say.org, 逐页打开,
// 捕获: 未捕获 JS 异常 / console.error / 状态码 >=400 的 API 请求 / 错误文案。
// 用法: node explore-live.mjs [BASE]
import { chromium } from "@playwright/test";
const BASE = process.argv[2] || "https://17say.org";

const ROLES = {
  admin: { email: "admin@17say.org", password: "Demo1234!" },
  teacher: { email: "emma@17say.org", password: "Demo1234!" },
  parent: { email: "lilyparent@17say.org", password: "Demo1234!" },
};

const PAGES = {
  admin: [
    "/admin",
    "/admin/audit",
    "/admin/leads",
    "/admin/packages",
    "/admin/alerts",
    "/admin/settings",
    "/settings",
    "/admin/notifications",
    "/admin/leave",
    "/admin/messages",
    "/admin/sessions",
    "/admin/teachers",
    "/admin/finance",
    "/admin/leave/makeup",
    "/admin/payroll",
    "/admin/import",
    "/admin/operations",
    "/admin/reports",
    "/admin/backups",
    "/schedule",
    "/students",
    "/leave",
    "/content",
  ],
  teacher: [
    "/teacher/today",
    "/teacher/payroll",
    "/schedule",
    "/students",
    "/admin/leads",
    "/admin/packages",
    "/admin/alerts",
    "/admin/settings",
    "/admin/leave",
    "/admin/messages",
    "/admin/sessions",
    "/admin/leave/makeup",
    "/admin/operations",
    "/admin/reports",
    "/leave",
    "/content",
  ],
  parent: ["/parent", "/settings", "/admin/messages", "/admin/sessions", "/leave", "/content"],
};

async function login(page, role) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 20000 });
  await page.fill("#login-email", role.email);
  await page.fill("#login-password", role.password);
  await page.click('button[type="submit"]');
  // 等到离开 /login
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const allFindings = [];

  for (const [roleName, role] of Object.entries(ROLES)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const errors = [];
    page.on("pageerror", (e) => errors.push({ kind: "pageerror", msg: e.message }));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push({ kind: "console", msg: m.text() });
    });
    page.on("response", (r) => {
      const u = r.url();
      if (u.includes("api.17say.org") && r.status() >= 400) {
        errors.push({ kind: "api", status: r.status(), url: u.replace(/^https:\/\/api\.17say\.org/, "") });
      }
    });

    console.log(`\n########## ${roleName} ##########`);
    try {
      await login(page, role);
      console.log(`登录成功, 落地页: ${new URL(page.url()).pathname}`);
    } catch (e) {
      console.log(`登录失败: ${e.message}`);
      allFindings.push({ role: roleName, path: "LOGIN", errors: [{ kind: "login", msg: e.message }] });
      await context.close();
      continue;
    }

    for (const path of PAGES[roleName]) {
      errors.length = 0;
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
        // 给数据加载和渲染留点时间
        await page.waitForTimeout(2500);
      } catch (e) {
        allFindings.push({ role: roleName, path, errors: [{ kind: "nav", msg: e.message }] });
        console.log(`  NAVFAIL ${path} ${e.message}`);
        continue;
      }

      // 检测页面是否有 React 错误边界 / 明显崩溃文案
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
      const crashHints = ["Something went wrong", "页面崩溃", "出现错误", "Application error", "TypeError", "Cannot read"];
      const crashed = crashHints.some((h) => bodyText.includes(h));
      // 是否基本空白
      const blank = bodyText.replace(/\s/g, "").length < 12;

      // 去重
      const uniq = [];
      const seen = new Set();
      for (const e of errors) {
        const key = JSON.stringify(e);
        if (!seen.has(key)) {
          seen.add(key);
          uniq.push(e);
        }
      }

      if (uniq.length || crashed || blank) {
        allFindings.push({ role: roleName, path, errors: uniq, crashed, blank });
        console.log(`  !! ${path}${crashed ? " [崩溃文案]" : ""}${blank ? " [空白]" : ""}`);
        for (const e of uniq) {
          console.log(`       - ${e.kind}${e.status ? " " + e.status : ""}: ${e.msg || e.url}`);
        }
        if (crashed || uniq.some((e) => e.kind === "pageerror")) {
          await page.screenshot({ path: `shot-${roleName}-${path.replace(/\W+/g, "_")}.png`, fullPage: false }).catch(() => {});
        }
      } else {
        console.log(`  ok ${path}`);
      }
    }
    await context.close();
  }

  await browser.close();

  console.log("\n========== 探测汇总 ==========");
  if (!allFindings.length) {
    console.log("未发现明显错误");
    return;
  }
  for (const f of allFindings) {
    console.log(`[${f.role}] ${f.path}${f.crashed ? " [崩溃]" : ""}${f.blank ? " [空白]" : ""}`);
    for (const e of f.errors) console.log(`    - ${e.kind}${e.status ? " " + e.status : ""}: ${e.msg || e.url}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
