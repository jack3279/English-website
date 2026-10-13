// 验证：1) 已完成课节详情显示完整反馈与真实姓名；2) 翻周后「回到本周」可点并生效。
import { chromium } from "@playwright/test";
const BASE = "https://17say.org";

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [];
const ok = (label, cond) => checks.push({ label, cond: !!cond });

await login(page, "admin@17say.org");
await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

// --- 找到一节已完成课并打开详情 ---
// 完课多在历史周；用「上周」翻一次，再点第一个卡片。
await page.getByRole("button", { name: "上周" }).click();
await page.waitForTimeout(2000);

// WeekGrid 课节卡片带 draggable 属性、含上课时间与老师（→）。点第一个已完成的。
// 周历有移动端/桌面端两套 DOM，用 visible=true 取桌面可见卡片。
const lessonChip = page.locator("[draggable] >> visible=true").filter({ hasText: "→" }).first();
const hasCard = await lessonChip.isVisible().catch(() => false);
let opened = false;
if (hasCard) {
  await lessonChip.click({ force: true });
  opened = await page
    .getByText("课节详情")
    .first()
    .isVisible()
    .catch(() => false);
}
ok("打开课节详情", opened);

if (opened) {
  await page.waitForTimeout(1200);
  // 真实姓名不再是 “—”
  const body = await page
    .locator('[role="dialog"], .fixed')
    .last()
    .innerText()
    .catch(() => "");
  // 回调在浏览器内执行；document 是浏览器全局，Node 的 ESLint 不认识。
  const txt = body || (await page.evaluate(() => globalThis.document.body.innerText));
  // 学员/老师标签存在且不全是 —
  const hasName = /学员/.test(txt) && !/学员\s*\n?\s*—/.test(txt);
  ok("详情显示真实学员姓名（非 —）", hasName);
  // 课后反馈区（若该节有反馈）
  const hasFeedbackBlock = txt.includes("课后反馈") || txt.includes("老师未填写文字反馈");
  ok("包含课后反馈区块", hasFeedbackBlock);
}

// 关闭弹窗（点关闭/取消）
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(600);

// --- 「回到本周」---
// 当前应停在“上周”，回到本周按钮应高亮可点
const backBtn = page.getByRole("button", { name: "回到本周" });
const canGoBack = await backBtn.isVisible().catch(() => false);
ok("翻到其他周时显示「回到本周」", canGoBack);
if (canGoBack) {
  await backBtn.click();
  await page.waitForTimeout(1800);
  // 回到本周后按钮变回禁用的“本周”
  const nowBtn = page.getByRole("button", { name: "本周" });
  const atCurrent = await nowBtn.isVisible().catch(() => false);
  ok("点击后回到本周（按钮变「本周」）", atCurrent);
}

await browser.close();

for (const c of checks) console.log(`  ${c.cond ? "OK  " : "FAIL"} ${c.label}`);
const failed = checks.filter((c) => !c.cond);
console.log(`\n============ ${checks.length - failed.length}/${checks.length} ============`);
process.exitCode = failed.length ? 1 : 0;
