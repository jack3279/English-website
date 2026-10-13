// v2 Stage 6 E2E: 公开招生状态流转 + 站内信发送 + 多角色登录
const { test, expect, request } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };
const TEACHER = { email: "emma@17say.org", password: "Demo1234!" };
const PARENT = { email: "lilyparent@17say.org", password: "Demo1234!" };

async function token(requestCtx, user) {
  const r = await requestCtx.post("https://api.17say.org/auth/login", {
    data: { email: user.email, password: user.password },
  });
  const j = await r.json();
  return j.data?.access_token;
}

test("v2 leads 公开提交 → admin 后台看到 → 状态流转", async ({ request: requestCtx, page }) => {
  // 1. 公开 POST /leads (无 token)
  const phone = `13${Date.now().toString().slice(-9)}`;
  const leadR = await requestCtx.post("https://api.17say.org/leads", {
    headers: { "content-type": "application/json" },
    data: {
      parent_name: "E2E 自动化家长",
      parent_phone: phone,
      child_name: "E2E 小朋友",
      child_age: 8,
      preferred_time: "工作日下午",
      notes: "Stage 6 端到端测试",
    },
  });
  expect(leadR.ok()).toBeTruthy();
  const leadJ = await leadR.json();
  expect(leadJ.data.id).toBeTruthy();
  expect(leadJ.data.status).toBe("new");
  console.log("  lead created:", leadJ.data.id, "phone:", phone);

  // 2. admin 登录后看 leads
  const tAdmin = await token(requestCtx, ADMIN);
  const listR = await requestCtx.get("https://api.17say.org/leads", {
    headers: { authorization: `Bearer ${tAdmin}` },
  });
  const list = (await listR.json()).data || [];
  const my = list.find((l) => l.parent_phone === phone);
  expect(my).toBeTruthy();
  expect(my.status).toBe("new");
  console.log("  lead visible in admin /leads");

  // 3. PATCH 流转到 contacted
  const patchR = await requestCtx.patch(`https://api.17say.org/leads/${my.id}`, {
    headers: { authorization: `Bearer ${tAdmin}`, "content-type": "application/json" },
    data: { status: "contacted" },
  });
  expect(patchR.status()).toBe(200);
  const patched = (await patchR.json()).data;
  expect(patched.status).toBe("contacted");
  console.log("  lead status: new → contacted");

  // 4. 流转到 trial_scheduled
  const patchR2 = await requestCtx.patch(`https://api.17say.org/leads/${my.id}`, {
    headers: { authorization: `Bearer ${tAdmin}`, "content-type": "application/json" },
    data: { status: "trial_scheduled" },
  });
  expect(patchR2.status()).toBe(200);
  expect((await patchR2.json()).data.status).toBe("trial_scheduled");

  // 5. 流转到 converted
  const patchR3 = await requestCtx.patch(`https://api.17say.org/leads/${my.id}`, {
    headers: { authorization: `Bearer ${tAdmin}`, "content-type": "application/json" },
    data: { status: "converted" },
  });
  expect(patchR3.status()).toBe(200);
  expect((await patchR3.json()).data.status).toBe("converted");
  console.log("  lead status: new → contacted → trial_scheduled → converted (4 states verified)");
});

test("v2 站内信 admin → teacher 发送成功", async ({ request: requestCtx }) => {
  const tAdmin = await token(requestCtx, ADMIN);
  const tTeacher = await token(requestCtx, TEACHER);

  // 找 teacher 的 userId (用 teammates endpoint)
  const tmR = await requestCtx.get("https://api.17say.org/messages/teammates", {
    headers: { authorization: `Bearer ${tAdmin}` },
  });
  const teammates = (await tmR.json()).data || [];
  const teacherTm = teammates.find((u) => u.role === "teacher");
  expect(teacherTm).toBeTruthy();
  console.log("  found teacher teammate:", teacherTm.full_name, teacherTm.id);

  // 发送 (用 Node fetch 避免 Playwright request fixture 的限制)
  const sendR = await fetch("https://api.17say.org/messages", {
    method: "POST",
    headers: { authorization: `Bearer ${tAdmin}`, "content-type": "application/json" },
    body: JSON.stringify({
      to_user: teacherTm.id,
      subject: `E2E 测试 ${new Date().toISOString().slice(11, 19)}`,
      body: "这是 E2E 自动化测试的站内信",
    }),
  });
  expect(sendR.ok).toBeTruthy();
  expect(sendR.status).toBe(200);
  const sent = (await sendR.json()).data;
  expect(sent.id).toBeTruthy();
  expect(sent.from_user).toBeTruthy();
  console.log("  sent msg id:", sent.id);

  // 老师登录看收件箱
  const inboxR = await requestCtx.get("https://api.17say.org/messages", {
    headers: { authorization: `Bearer ${tTeacher}` },
  });
  expect(inboxR.status()).toBe(200);
  const inbox = (await inboxR.json()).data || [];
  const myMsg = inbox.find((m) => m.id === sent.id);
  expect(myMsg).toBeTruthy();
  expect(myMsg.subject).toContain("E2E 测试");
  console.log("  teacher inbox contains msg, subject:", myMsg.subject);

  // 未读数
  const ucR = await requestCtx.get("https://api.17say.org/messages/unread-count", {
    headers: { authorization: `Bearer ${tTeacher}` },
  });
  const uc = (await ucR.json()).data;
  expect(uc.count).toBeGreaterThanOrEqual(1);

  // 标记已读
  const mrR = await requestCtx.patch(`https://api.17say.org/messages/${sent.id}`, {
    headers: { authorization: `Bearer ${tTeacher}` },
  });
  expect(mrR.status()).toBe(200);
  expect((await mrR.json()).data.read_at).toBeTruthy();
  console.log("  mark-read OK, full message flow verified");
});

test("v2 三角色登录: admin/teacher/parent 各自 redirect", async ({ page }) => {
  // admin → /admin
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\b/, { timeout: 20_000 });
  console.log("  admin →", page.url().split("/").slice(3).join("/"));

  // teacher → /teacher/today
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.fill('input[type="email"]', TEACHER.email);
  await page.fill('input[type="password"]', TEACHER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/teacher\/today/, { timeout: 20_000 });
  console.log("  teacher →", page.url().split("/").slice(3).join("/"));

  // parent → /parent
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.fill('input[type="email"]', PARENT.email);
  await page.fill('input[type="password"]', PARENT.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/parent/, { timeout: 20_000 });
  console.log("  parent →", page.url().split("/").slice(3).join("/"));
});