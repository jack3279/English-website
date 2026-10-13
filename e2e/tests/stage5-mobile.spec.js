const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

test.use({ viewport: { width: 375, height: 812 } });

test("v2 mobile: hamburger button visible, desktop sidebar hidden", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  const hamburger = page.locator('button[aria-label="\u6253\u5f00\u83dc\u5355"]');
  await expect(hamburger).toBeVisible({ timeout: 5_000 });
  console.log("  hamburger visible on mobile");

  const sidebarItems = page.locator('aside nav a:has-text("\u603b\u89c8")');
  expect(await sidebarItems.first().isVisible().catch(() => false)).toBeFalsy();
  console.log("  desktop sidebar hidden on mobile");

  await hamburger.click();
  await page.waitForTimeout(500);
  const drawer = page.locator('div[role="dialog"] nav a:has-text("\u603b\u89c8")');
  await expect(drawer.first()).toBeVisible({ timeout: 5_000 });
  console.log("  drawer visible after click");
});

test("v2 mobile: /schedule uses horizontal scroll week grid", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  await page.goto("/schedule");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  // mobile flex-scroll visible, 7-col grid hidden
  const grid = page.locator('div.hidden.sm\\:grid').first();
  expect(await grid.isVisible().catch(() => false)).toBeFalsy();

  // week 容器在 mobile 是 flex overflow-x-auto
  const flexContainer = page.locator('div.flex.gap-2.overflow-x-auto').first();
  expect(await flexContainer.isVisible().catch(() => false)).toBeTruthy();
  console.log("  schedule: horizontal scroll visible, 7-col grid hidden");

  // lesson card visible
  const card = page.locator('div[class*="rounded-md"][class*="p-2"]').first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  console.log("  lesson card visible");

  // 滑动提示
  const hint = page.locator('text=/\u5de6\u53f3\u6ed1\u52a8/');
  await expect(hint).toBeVisible();
  console.log("  horizontal scroll hint visible");
});
