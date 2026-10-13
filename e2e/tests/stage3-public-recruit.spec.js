// v2 Stage 3.1 E2E: 公开 /recruit 提交 -> /admin/leads 看到
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function login(page, user) {
  await page.goto("/login");
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

test("v2 公开招生: /recruit submit -> /admin/leads 看到", async ({ page }) => {
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  const uniquePhone = `13${Date.now().toString().slice(-9)}`;

  // 1. 公开访问 /recruit (无登录)
  await page.goto("/recruit");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("text=免费预约试听").first()).toBeVisible({ timeout: 10_000 });

  // 2. 填表
  await page.fill('input[id="parent_name"]', "E2E 妈妈");
  await page.fill('input[id="parent_phone"]', uniquePhone);
  await page.fill('input[id="child_name"]', "E2E 小朋友");
  await page.fill('input[id="child_age"]', "8");
  await page.selectOption('select[id="preferred_time"]', "工作日下午");
  await page.fill('textarea[id="notes"]', "Stage 3.1 E2E 自动化测试");

  // 3. 提交
  await page.click('button:has-text("立即预约")');
  await expect(page.locator("text=报名成功").first()).toBeVisible({ timeout: 10_000 });
  console.log("  public submit OK, phone=", uniquePhone);

  // 4. 切到 admin 登录
  await page.evaluate(() => localStorage.clear());
  await login(page, ADMIN);
  await page.waitForURL(/\/admin|\/students|\/schedule/, { timeout: 20_000 });

  // 5. 跳 /admin/leads
  await page.goto("/admin/leads");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // 等 TanStack Query 拿到 list

  // 6. 找到刚才那条 (用手机号识别, 因为可能多条)
  const lead = page.locator(`text=${uniquePhone}`).first();
  await expect(lead).toBeVisible({ timeout: 30_000 });
  console.log("  admin lead visible:", uniquePhone);

  // 7. 截图为证
  await page.screenshot({ path: "e2e/test-results/stage3-recruit.png", fullPage: true });
});
