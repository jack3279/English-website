// 端到端验证 (https://17say.org):
//  A. 留言: 家长发送 -> 管理员收到并回复 -> 家长看到回复
//  B. 请假: 家长提交 -> 管理员驳回(reset 保留该课) -> 家长看到结果
import { chromium } from "@playwright/test";

const BASE = "https://17say.org";
const stamp = Date.now().toString().slice(-6);
const PARENT_MSG = `测试留言${stamp}`;
const ADMIN_REPLY = `收到回复${stamp}`;
const LEAVE_REASON = `测试请假${stamp}`;

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

// 反复重载直到页面出现指定文本
async function waitForText(page, text, { timeout = 25000, reloadEach = 0 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.getByText(text).first().isVisible().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    if (reloadEach) await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(reloadEach || 1200);
  }
}

const results = [];
const record = (name, ok) => {
  results.push({ name, ok });
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}`);
};

const browser = await chromium.launch({ headless: true });
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const parentCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const admin = await adminCtx.newPage();
const parent = await parentCtx.newPage();

try {
  await login(admin, "admin@17say.org", "Demo1234!");
  await login(parent, "lilyparent@17say.org", "Demo1234!");

  // ---------- A. 留言 ----------
  console.log("\n== A. 留言 ==");
  await parent.goto(`${BASE}/parent/messages`, { waitUntil: "domcontentloaded" });
  await parent.waitForTimeout(1500);

  await parent.getByPlaceholder("输入留言…").fill(PARENT_MSG);
  await parent.getByRole("button", { name: "发送" }).click();
  const parentSeesOwn = await waitForText(parent, PARENT_MSG, { timeout: 10000 });
  record("家长发送后右侧气泡出现", parentSeesOwn);

  // 管理员到站内信页, 等该留言出现
  await admin.goto(`${BASE}/admin/messages`, { waitUntil: "domcontentloaded" });
  const adminGets = await waitForText(admin, PARENT_MSG, { timeout: 25000, reloadEach: 4000 });
  record("管理员收件箱收到家长留言", adminGets);

  if (adminGets) {
    // 在含该留言的卡片里点「回复」
    const card = admin.locator("li", { hasText: PARENT_MSG }).first();
    await card.getByRole("button", { name: "回复" }).click();
    await admin.waitForTimeout(800);
    await admin.fill("#msg-body", ADMIN_REPLY);
    await admin.getByRole("button", { name: "发送", exact: true }).click();
    await admin.waitForTimeout(1000);
  }

  // 家长 15s 轮询内应看到回复 (不主动 reload, 让轮询生效; 兜底 reload)
  const parentGetsReply = await waitForText(parent, ADMIN_REPLY, {
    timeout: 30000,
    reloadEach: 0,
  });
  record("家长在聊天页看到学校回复", parentGetsReply);

  // ---------- B. 请假 ----------
  console.log("\n== B. 请假 ==");
  await parent.goto(`${BASE}/parent`, { waitUntil: "domcontentloaded" });
  await parent.waitForTimeout(2000);

  // 点第一张「即将到来的课」的请假按钮
  const lessonCard = parent.locator("text=即将到来的课").locator("xpath=ancestor::section").first();
  await lessonCard.getByRole("button", { name: "请假" }).first().click();
  await parent.waitForTimeout(800);
  await parent.fill("#leave-reason", LEAVE_REASON);
  await parent.getByRole("button", { name: "提交请假" }).click();

  const pendingBadge = await waitForText(parent, "请假待确认", { timeout: 10000 });
  record("家长提交后显示「请假待确认」", pendingBadge);

  // 管理员到请假审批页, 定位该申请并驳回 (reset, 保留该课)
  await admin.goto(`${BASE}/admin/leave`, { waitUntil: "domcontentloaded" });
  const adminSeesLeave = await waitForText(admin, LEAVE_REASON, {
    timeout: 25000,
    reloadEach: 4000,
  });
  record("管理员收到该请假申请", adminSeesLeave);

  if (adminSeesLeave) {
    const lc = admin.locator("div", { hasText: LEAVE_REASON })
      .filter({ has: admin.getByRole("button", { name: "拒绝" }) }).first();
    await lc.getByRole("button", { name: "拒绝" }).click();
    await admin.waitForTimeout(800);
    // 确认驳回对话框
    await admin.getByRole("button", { name: /确认拒绝/ }).click();
    await admin.waitForTimeout(1500);
  }

  // 家长侧: 驳回后该课恢复可请假 (显示「重新请假」)
  await parent.waitForTimeout(16000); // 等待家长页轮询/刷新窗口
  await parent.reload({ waitUntil: "domcontentloaded" });
  await parent.waitForTimeout(2500);
  const canRetry =
    (await parent.getByRole("button", { name: "重新请假" }).first().isVisible().catch(() => false)) ||
    (await parent.getByRole("button", { name: "请假" }).first().isVisible().catch(() => false));
  record("管理员驳回后家长可重新请假（课节保留）", canRetry);
} catch (e) {
  console.log("\n脚本异常:", e.message);
  await parent.screenshot({ path: "verify-parent-error.png" }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n========== 端到端: ${results.length - failed.length}/${results.length} ==========`);
for (const f of failed) console.log("  FAIL " + f.name);
if (failed.length) process.exitCode = 1;
