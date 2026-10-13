// v2 Stage 5 E2E: 端到端 - 老师完课 → 反馈 → 家长看到
const { test, expect, request } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };
const TEACHER = { email: "alice.t@17say.org", password: "Demo1234!" };
const PARENT = { email: "david.p@17say.org", password: "Demo1234!" };

async function token(ctx, user) {
  const r = await ctx.post("https://api.17say.org/auth/login", {
    data: { email: user.email, password: user.password },
  });
  return (await r.json()).data?.access_token;
}

test("v2 端到端: 老师完课 → 家长立即看到反馈", async ({ request: requestCtx }) => {
  // 1. admin login
  const tA = await token(requestCtx, ADMIN);
  // 触发 seed (幂等)
  const seedR = await requestCtx.post("https://api.17say.org/admin/seed-demo", {
    headers: { authorization: `Bearer ${tA}` },
  });
  expect(seedR.ok()).toBeTruthy();

  // 2. 找 David Jr
  const stuR = await requestCtx.get("https://api.17say.org/students?pageSize=20", {
    headers: { authorization: `Bearer ${tA}` },
  });
  const students = (await stuR.json()).data || [];
  const david = students.find((s) => s.full_name === "David Jr");
  expect(david).toBeTruthy();
  const davidId = david.id;

  // 3. 找 alice 的一个 scheduled lesson for David Jr
  const today = new Date();
  const from = new Date(today.getTime() - 14 * 86400_000).toISOString();
  const to = new Date(today.getTime() + 14 * 86400_000).toISOString();
  const sR = await requestCtx.get(
    `https://api.17say.org/schedules?from=${from}&to=${to}&teacher_id=${"d82ba74a-98de-4776-b37c-23080073746c"}`,
    { headers: { authorization: `Bearer ${tA}` } },
  );
  // 简化: teacher_id 改为 alice profile_id (上面是 teachers.id), 但 schedule 用 profiles 联.
  // 找任意 scheduled lesson 给 David Jr
  const sR2 = await requestCtx.get(`https://api.17say.org/schedules?from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${tA}` },
  });
  const lessons = (await sR2.json()).data || [];
  const target = lessons.find((l) => l.status === "scheduled" && l.student_id === davidId);
  expect(target).toBeTruthy();
  console.log("  alice 准备完课:", target.id);

  // 4. 老师 alice login, 完课
  const tT = await token(requestCtx, TEACHER);
  const noteText = `E2E 反馈 ${Date.now()}`;
  const cR = await requestCtx.post(`https://api.17say.org/lessons/${target.id}/complete`, {
    headers: { authorization: `Bearer ${tT}`, "content-type": "application/json" },
    data: {
      content: noteText,
      performance: "excellent",
      homework: "review",
      next_plan: "next lesson",
      publishToParent: true,
    },
  });
  expect(cR.ok()).toBeTruthy();
  const cJ = await cR.json();
  expect(cJ.data.lessonId).toBe(target.id);
  console.log("  completed, newBalance:", cJ.data.newBalance);

  // 5. 家长 login 立即 GET /parent/feeds 看到反馈
  const tP = await token(requestCtx, PARENT);
  const pR = await requestCtx.get(`https://api.17say.org/parent/feeds?studentId=${davidId}`, {
    headers: { authorization: `Bearer ${tP}` },
  });
  expect(pR.ok()).toBeTruthy();
  const pJ = await pR.json();
  const feeds = pJ.data || [];
  console.log("  parent_feeds count:", feeds.length);
  expect(feeds.length).toBeGreaterThan(0);
  // 最新一条 = 我们刚发
  const newest = feeds[0];
  console.log("  newest feed:", newest.summary);
  expect(newest.summary).toContain(noteText);
  expect(newest.student_id).toBe(davidId);
  console.log("  END-TO-END OK: teacher feedback -> parent sees it");
});
