// 验证老师/家长的「自己的课表」：能打开、数据是自己的、管理员按钮已隐藏。
import { chromium } from "@playwright/test";
const BASE = "https://17say.org";

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

async function verify({ name, email, expectSidebarLabel }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const out = { name, checks: [] };
  const ok = (label, cond) => out.checks.push({ label, cond: !!cond });

  await login(page, email, "Demo1234!");
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // 1. 页面打开且标题为课程表
  ok(
    "打开 /schedule 显示「课程表」",
    await page
      .getByText("课程表")
      .first()
      .isVisible()
      .catch(() => false),
  );

  // 2. 管理员专属按钮已隐藏
  ok("隐藏「新建排课」", !(await page.getByRole("button", { name: "新建排课" }).count()));
  ok("隐藏「按规律课生成」", !(await page.getByRole("button", { name: "按规律课生成" }).count()));
  ok("隐藏「导出 Excel」", !(await page.getByRole("button", { name: /导出 Excel/ }).count()));

  // 3. 侧边栏有自己的课表入口
  ok(
    `侧边栏可见「${expectSidebarLabel}」`,
    await page
      .getByRole("link", { name: expectSidebarLabel })
      .first()
      .isVisible()
      .catch(() => false),
  );

  // 4. 本周课节数（副标题里的 "N 节课"）
  const subtitle = await page
    .locator(".text-gray-400, .text-gray-500")
    .allInnerTexts()
    .catch(() => []);
  const m = subtitle.join(" ").match(/(\d+)\s*节课/);
  out.lessonCount = m ? Number(m[1]) : null;

  await browser.close();
  return out;
}

const teacher = await verify({
  name: "老师 Emma",
  email: "emma@17say.org",
  expectSidebarLabel: "我的课表",
});
const parent = await verify({
  name: "家长 Lily",
  email: "lilyparent@17say.org",
  expectSidebarLabel: "课程表",
});

for (const r of [teacher, parent]) {
  console.log(`\n== ${r.name}（本周 ${r.lessonCount} 节课）==`);
  for (const c of r.checks) console.log(`  ${c.cond ? "OK  " : "FAIL"} ${c.label}`);
}

const all = [...teacher.checks, ...parent.checks];
const failed = all.filter((c) => !c.cond);
console.log(`\n============ ${all.length - failed.length}/${all.length} ============`);
process.exitCode = failed.length ? 1 : 0;
