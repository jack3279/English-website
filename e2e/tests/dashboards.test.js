// v2 Stage 1 集成测试: 3 dashboard 加载 + signup 流程
// 跑前需要: web 跑在 E2E_BASE_URL (默认 http://127.0.0.1:5174), api 跑在 :3001, supabase 已 seed
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };
const TEACHER = { email: "emma@17say.org", password: "Demo1234!" };
const PARENT = { email: "lilyparent@17say.org", password: "Demo1234!" };

async function login(page, user) {
  await page.goto("/login");
  await page.fill("input[type=email]", user.email);
  await page.fill("input[type=password]", user.password);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
}

test("admin dashboard 加载 + 显示关键指标", async ({ page }) => {
  await login(page, ADMIN);
  await page.waitForURL("**/admin", { timeout: 15_000 });
  await expect(page.locator("text=总览").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("text=今日课数").first()).toBeVisible();
});

test("teacher dashboard 加载", async ({ page }) => {
  await login(page, TEACHER);
  await page.waitForURL("**/teacher/**", { timeout: 15_000 });
  // 现有 teacher 页: TodayLessonsPage 有 "今日课程" 标题
  await expect(page.locator("text=今日课程").first()).toBeVisible({ timeout: 10_000 });
});

test("parent dashboard 加载", async ({ page }) => {
  await login(page, PARENT);
  await page.waitForURL("**/parent", { timeout: 15_000 });
  // 现有 parent 页: ParentHomePage 有 "家长中心" 标题
  await expect(page.locator("text=家长中心").first()).toBeVisible({ timeout: 10_000 });
});

test("signup 表单加载 + 显示字段", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("text=注册").first()).toBeVisible();
  await expect(page.locator("input[type=email]").first()).toBeVisible();
  await expect(page.locator("input[type=password]").first()).toBeVisible();
});

test("forgot password 表单加载", async ({ page }) => {
  await page.goto("/forgot");
  await expect(page.locator("text=重置密码").first()).toBeVisible();
  await expect(page.locator("input[type=email]").first()).toBeVisible();
});
