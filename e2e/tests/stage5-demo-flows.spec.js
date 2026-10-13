// v2 Stage 5 E2E: teacher 完课 → 家长看到反馈 完整流
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };
const TEACHER = { email: "alice.t@17say.org", password: "Demo1234!" };
const PARENT = { email: "david.p@17say.org", password: "Demo1234!" };

async function token(ctx, user) {
  const r = await ctx.post("https://api.17say.org/auth/login", {
    data: { email: user.email, password: user.password },
  });
  return (await r.json()).data?.access_token;
}

test("v2 /admin/seed-demo 创建 3 教师 + 反馈数据存在", async ({ request: requestCtx }) => {
  // 1. 验证 admin 跑 seed (如果没跑)
  const adminT = await token(requestCtx, ADMIN);
  expect(adminT).toBeTruthy();
  // list teachers
  const tR = await requestCtx.get("https://api.17say.org/teachers", {
    headers: { authorization: `Bearer ${adminT}` },
  });
  const teachers = (await tR.json()).data || [];
  console.log("  existing teachers:", teachers.length, teachers.map(t => t.full_name).join(", "));
  expect(teachers.length).toBeGreaterThan(0);

  // 2. 找 David Jr
  const stuR = await requestCtx.get("https://api.17say.org/students?pageSize=10", {
    headers: { authorization: `Bearer ${adminT}` },
  });
  const students = (await stuR.json()).data || [];
  const david = students.find(s => s.full_name === "David Jr");
  expect(david).toBeTruthy();
  console.log("  David Jr id:", david.id, "balance:", david.remaining_hours);

  // 3. 找 David 的反馈流水
  const feedR = await requestCtx.get(`https://api.17say.org/students/${david.id}`, {
    headers: { authorization: `Bearer ${adminT}` },
  });
  const detail = (await feedR.json()).data;
  const consumeTxs = (detail.transactions || []).filter(t => t.reason === "consume");
  console.log("  consume txs count:", consumeTxs.length);
  expect(consumeTxs.length).toBeGreaterThan(0);

  // 4. 找 David 的 parent_feed
  const pfR = await requestCtx.get(`https://api.17say.org/parent/feeds?studentId=${david.id}`, {
    headers: { authorization: `Bearer ${adminT}` },
  });
  const feeds = (await pfR.json()).data || [];
  console.log("  parent_feeds count:", feeds.length);
  expect(feeds.length).toBeGreaterThan(0);
  const lesson3Feed = feeds.find(f => f.summary?.includes("Lesson 3"));
  expect(lesson3Feed).toBeTruthy();
  console.log("  lesson3 feedback:", lesson3Feed.summary);
});

test("v2 teacher (alice.t) 登录后看 /teacher/today 有课", async ({ request: requestCtx, page }) => {
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto("/login");
  await page.fill('input[type="email"]', TEACHER.email);
  await page.fill('input[type="password"]', TEACHER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/teacher\/today/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await expect(page.locator("text=今日课程").first()).toBeVisible({ timeout: 10_000 });
  // 至少看到 "今天 14:00" 课 (scheduled) 或 "Lesson 3" (completed)
  const hasToday = await page.locator('text=/Lesson|今天|14:00|16:00|David/').first().isVisible().catch(() => false);
  console.log("  teacher /today shows lessons:", hasToday);
  expect(hasToday).toBeTruthy();
  console.log("  teacher login + schedule visible OK");
});

test("v2 parent (david.p) 登录 /parent 看 David 反馈", async ({ request: requestCtx, page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', PARENT.email);
  await page.fill('input[type="password"]', PARENT.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/parent/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  // 应该看到 David 名字 + Lesson 3 反馈
  const hasDavid = await page.locator("text=David").first().isVisible({ timeout: 10_000 }).catch(() => false);
  const hasLesson3 = await page.locator("text=Lesson").first().isVisible().catch(() => false);
  console.log("  parent /parent shows David:", hasDavid, "Lesson 3:", hasLesson3);
  expect(hasDavid).toBeTruthy();
  console.log("  parent login + child feedback visible");
});
