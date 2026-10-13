// v2 Stage 5 E2E: 财务报表 + 教师 CRUD + 手动调整课时
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function adminLogin(page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
}

test("v2 admin: /admin/finance shows summary + exceptions", async ({ page }) => {
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await adminLogin(page);
  await page.goto("/admin/finance");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  await expect(page.locator("text=财务报表").first()).toBeVisible({ timeout: 10_000 });
  // 4 个 stat tile
  await expect(page.locator("text=本月营收").first()).toBeVisible();
  await expect(page.locator("text=本月消耗课时").first()).toBeVisible();
  await expect(page.locator("text=在读学员").first()).toBeVisible();
  await expect(page.locator("text=低余额").first()).toBeVisible();
  console.log("  finance page OK");
});

test("v2 admin: /admin/teachers page loads + new button", async ({ page }) => {
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [console-err]", msg.text());
  });
  await adminLogin(page);
  await page.goto("/admin/teachers");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // 宽松: 任何 h1 或"教师"text 都行
  const headerOk = await page.locator('h1:has-text("教师"), h1:has-text("Teacher")').first().isVisible().catch(() => false);
  expect(headerOk).toBeTruthy();
  await expect(page.locator('button:has-text("新增教师")').first()).toBeVisible();
  console.log("  teachers page OK");
});

test("v2 admin: /students/:id shows adjust button + opens dialog", async ({ page }) => {
  await adminLogin(page);
  // 找第一个 student
  await page.goto("/students");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const firstLink = page.locator('a[href*="/students/"]').first();
  await expect(firstLink).toBeVisible({ timeout: 10_000 });
  const href = await firstLink.getAttribute("href");
  await page.goto(href);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  // 课时包 card 里有 手动调整课时 button
  const adjustBtn = page.locator('button:has-text("手动调整课时")').first();
  await expect(adjustBtn).toBeVisible({ timeout: 10_000 });
  await adjustBtn.click();
  await expect(page.locator("text=手动调整课时").first()).toBeVisible();
  // 表单字段
  await expect(page.locator('input#adj-delta').first()).toBeVisible();
  await expect(page.locator('input#adj-reason').first()).toBeVisible();
  console.log("  adjust-hours dialog opens OK");
  await page.keyboard.press("Escape");
});