// Happy path E2E: 完课 → 家长 H5 实时看到反馈
// 通过 fixtures.resetAndSeed() 保证 test 间数据干净
const { test, expect } = require("@playwright/test");
const { resetAndSeed } = require("./fixtures.js");

const TEACHER = { email: "emma@17say.org", password: "Demo1234!" };
const PARENT = { email: "lilyparent@17say.org", password: "Demo1234!" };

async function login(page, user) {
  await page.goto("/login");
  await page.fill("input[type=email]", user.email);
  await page.fill("input[type=password]", user.password);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async () => {
  // 每个 test 之前 reset + reseed, 保证有 1 节 scheduled lesson
  await resetAndSeed();
});

test("完课 → 家长 H5 实时看到反馈", async ({ page }) => {
  test.skip(process.env.SUPABASE_SERVICE_ROLE_KEY ? false : true, "needs SUPABASE_SERVICE_ROLE_KEY for fixtures reset+seed");
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("login error") || msg.type() === "error")
      console.log("  [browser]", msg.type(), t);
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  // 1. teacher 登录
  await login(page, TEACHER);
  await page.waitForURL("**/teacher/today", { timeout: 15_000 });

  // 2. 找到"完成本节课"按钮并点击
  const completeBtn = page.locator('button:has-text("完成本节课")').first();
  await expect(completeBtn).toBeVisible({ timeout: 10_000 });
  await completeBtn.click();

  // 3. 填写完课表单
  await page.fill("textarea >> nth=0", "今天学 Unit 5 (E2E)");
  await page.fill("textarea >> nth=1", "积极参与");
  await page.click("button[type=submit]");

  // 4. 验证 lesson 状态变成 "已完成"
  await expect(page.locator("text=已完成").first()).toBeVisible({ timeout: 10_000 });

  // 5. 切到 parent: 清 localStorage + 重新登录
  await page.evaluate(() => localStorage.clear());
  await login(page, PARENT);

  // 6. 家长 H5: 强制 reload 拿历史 parent_feeds (Realtime 新订阅不重发)
  await page.goto("/parent");
  await page.waitForLoadState("networkidle");

  // 7. 等 React Query 拿到 feeds
  await expect(page.locator("text=Unit 5").first()).toBeVisible({ timeout: 15_000 });
});
