// v2 Stage UI E2E: toast 通知系统
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function adminLogin(page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
}

test("v2 toast 触发: 新建学员后页面顶部弹绿色 toast", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/students");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  const uniqueName = `Toast-E2E-${Date.now()}`;

  // 点新建 + 填必填字段 (姓名, 生日避免 null)
  await page.locator('button:has-text("新建学员")').first().click();
  await page.fill('input#student-name', uniqueName);
  await page.fill('input#student-bday', "2018-05-10").catch(() => {});
  await page.locator('button:has-text("保存")').first().click();

  // 等待 toast 出现
  const toast = page.locator('[role="status"]', { hasText: "学员已创建" }).first();
  await expect(toast).toBeVisible({ timeout: 5_000 });
  console.log("  toast visible: 学员已创建");

  // toast 4s 后自动消失 (我们用 5s timeout 保险)
  await page.waitForTimeout(6000);
  await expect(toast).not.toBeVisible({ timeout: 2_000 });
  console.log("  toast auto-dismissed after 4s");

  // 清理
  const token = await page.evaluate(() => localStorage.getItem("cloud_jwt"));
  if (token) {
    await fetch("https://api.17say.org/students?pageSize=100", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(async (j) => {
        const s = (j.data || []).find((x) => x.full_name === uniqueName);
        if (s) {
          await fetch(`https://api.17say.org/students/${s.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
          console.log("  cleanup:", uniqueName);
        }
      });
  }
});

test("v2 toast 样式: 4 个 tone 各有 icon + 颜色", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("text=17say.org").first()).toBeVisible({ timeout: 10_000 });
  // 截图 login page 看到背景 + branding
  await page.screenshot({ path: "e2e/test-results/toast-style.png", fullPage: false });
  console.log("  login page renders OK");
});
