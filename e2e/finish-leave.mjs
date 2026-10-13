// 收尾: 把上一步遗留的待审批测试请假驳回, 并验证家长侧结果。
import { chromium } from "@playwright/test";
const BASE = "https://17say.org";
const LEAVE_REASON = "测试请假269516";

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const parentCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const admin = await adminCtx.newPage();
const parent = await parentCtx.newPage();

let rejectOk = false;
let parentResult = false;

try {
  await login(admin, "admin@17say.org", "Demo1234!");
  await login(parent, "lilyparent@17say.org", "Demo1234!");

  await admin.goto(`${BASE}/admin/leave`, { waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(2000);

  // 定位含该请假原因的卡片(直接在含「批准」按钮的最小卡片里操作), 用精确按钮名
  const card = admin
    .locator("div")
    .filter({ hasText: LEAVE_REASON })
    .filter({ has: admin.getByRole("button", { name: "批准", exact: true }) })
    .last();
  await card.getByRole("button", { name: "拒绝", exact: true }).click();
  await admin.waitForTimeout(800);
  await admin.getByRole("button", { name: "确认拒绝" }).click();
  await admin.waitForTimeout(1500);
  rejectOk = await admin.getByText("已拒绝请假").first().isVisible().catch(() => false);
  console.log(rejectOk ? "OK   管理员已驳回该请假" : "FAIL 驳回未确认");

  // 家长侧: 等轮询窗口后刷新, 应能重新请假(课节保留)
  await parent.goto(`${BASE}/parent`, { waitUntil: "domcontentloaded" });
  await parent.waitForTimeout(16000);
  await parent.reload({ waitUntil: "domcontentloaded" });
  await parent.waitForTimeout(2500);
  parentResult =
    (await parent.getByRole("button", { name: "重新请假" }).first().isVisible().catch(() => false)) ||
    (await parent.getByRole("button", { name: "请假" }).first().isVisible().catch(() => false));
  console.log(parentResult ? "OK   家长可重新请假，课节保留" : "FAIL 家长侧未恢复");
} catch (e) {
  console.log("异常:", e.message);
} finally {
  await browser.close();
}
process.exitCode = rejectOk && parentResult ? 0 : 1;
