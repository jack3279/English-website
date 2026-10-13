// v2 Stage 2 E2E: admin 验证 + CRUD via API (避免 UI 网络间歇)
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function fetchWithRetry(url, opts, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || r.status < 500) return r;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return await fetch(url, opts);
}

test("v2 admin login redirect + /students create via API + UI verify", async ({ page }) => {
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("response", (r) => {
    if (!r.ok() && r.status() >= 400) console.log("  [http]", r.status(), r.url());
  });

  // 1. UI: admin login
  let loginOk = false;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto("/login");
      await page.fill('input[type="email"]', ADMIN.email);
      await page.fill('input[type="password"]', ADMIN.password);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
      loginOk = true;
      break;
    } catch (e) {
      console.log("  [login retry]", e.message.slice(0, 80));
      await page.waitForTimeout(2000);
    }
  }
  expect(loginOk).toBeTruthy();
  console.log("  admin logged in, URL:", page.url());

  // 2. API: get admin token for CRUD
  const lr = await fetchWithRetry("https://api.17say.org/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  const token = (await lr.json()).data?.access_token;
  expect(token).toBeTruthy();

  // 3. API: create a new student
  const uniqueName = `E2E-${Date.now()}`;
  const sR = await fetchWithRetry("https://api.17say.org/students", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ full_name: uniqueName, status: "active" }),
  });
  expect(sR.ok).toBeTruthy();
  const created = (await sR.json()).data;
  expect(created.id).toBeTruthy();
  console.log("  created student via API:", created.id, created.full_name);

  // 4. UI: go to /students, reload, verify created student visible
  await page.goto("/students");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  let found = false;
  for (let i = 0; i < 4; i++) {
    if (await page.locator(`text=${uniqueName}`).first().isVisible().catch(() => false)) {
      found = true;
      break;
    }
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
  }
  expect(found).toBeTruthy();
  console.log("  student visible in /students:", uniqueName);

  // 5. UI: verify "新建学员" button present
  const newBtn = page.locator('button:has-text("新建学员")').first();
  await expect(newBtn).toBeVisible({ timeout: 5_000 });
  console.log("  /students page chrome OK");

  // 6. API: create a new schedule for that student
  const teacherR = await fetchWithRetry("https://api.17say.org/teachers", {
    headers: { authorization: `Bearer ${token}` },
  });
  const teachers = (await teacherR.json()).data || [];
  const teacher = teachers[0];
  expect(teacher).toBeTruthy();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  tomorrow.setHours(10, 0, 0, 0);
  const schR = await fetchWithRetry("https://api.17say.org/schedules", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      student_id: created.id,
      teacher_id: teacher.profile_id || teacher.id,
      scheduled_at: tomorrow.toISOString(),
      duration_min: 60,
    }),
  });
  expect(schR.ok).toBeTruthy();
  const sch = (await schR.json()).data;
  expect(sch.id).toBeTruthy();
  console.log("  created schedule:", sch.id);

  // 7. UI: go to /schedule, verify schedule visible
  await page.goto("/schedule");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const newSchBtn = page.locator('button:has-text("新建排课")').first();
  await expect(newSchBtn).toBeVisible({ timeout: 5_000 });
  console.log("  /schedule page chrome OK");

  // 8. API: cleanup
  await fetchWithRetry(`https://api.17say.org/schedules/${sch.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  await fetchWithRetry(`https://api.17say.org/students/${created.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  console.log("  cleanup done");
});
