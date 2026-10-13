// v2 Tier 1 e2e: 通知管理 + 请假审批 + 404 + 设置
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

test.use({ viewport: { width: 1280, height: 800 } });

test("v2 Tier 1: 通知管理页面加载 + 列表 + 发送对话框", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  await page.goto("/admin/notifications");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  await expect(page.locator("text=通知中心").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('button:has-text("发送通知")').first()).toBeVisible();
  // 至少一个 filter pill
  await expect(page.locator('text=全部').first()).toBeVisible();
  console.log("  notifications page OK");

  // 点开"发送通知"对话框
  await page.locator('button:has-text("发送通知")').first().click();
  await page.waitForTimeout(500);
  await expect(page.locator('text=发送新通知').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('input#nt-title').first()).toBeVisible();
  console.log("  create dialog opens");
  // 关闭
  await page.keyboard.press("Escape");
});

test("v2 Tier 1: 请假审批页面加载 + 3 个过滤", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  await page.goto("/admin/leave");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  await expect(page.locator("text=请假审批").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=待审批').first()).toBeVisible();
  await expect(page.locator('text=已批准').first()).toBeVisible();
  await expect(page.locator('text=已拒绝').first()).toBeVisible();
  console.log("  leave page OK");
});

test("v2 Tier 1: /settings 页面加载", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  await expect(page.locator("text=系统设置").first()).toBeVisible({ timeout: 10_000 });
  console.log("  /settings OK");
});

test("v2 Tier 1: 真正的 404 页面", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  // 访问不存在的路径
  await page.goto("/admin/nonexistent-test-9999");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await expect(page.locator("text=404").first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=页面不存在").first()).toBeVisible();
  await expect(page.locator('button:has-text("回到首页")').first()).toBeVisible();
  console.log("  404 page OK");
});
