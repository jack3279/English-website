// v2 Stage 5 E2E: 课程表拖拽 (PATCH /lessons/:id 改 scheduled_at)
const { test, expect, request } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function token(ctx, user) {
  const r = await ctx.post("https://api.17say.org/auth/login", {
    data: { email: user.email, password: user.password },
  });
  return (await r.json()).data?.access_token;
}

test("v2 PATCH /lessons/:id reschedule 改时间", async ({ request: requestCtx }) => {
  const tA = await token(requestCtx, ADMIN);

  // 找一个 scheduled lesson
  const today = new Date();
  const from = new Date(today.getTime() - 14 * 86400_000).toISOString();
  const to = new Date(today.getTime() + 14 * 86400_000).toISOString();
  const sR = await requestCtx.get(`https://api.17say.org/schedules?from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${tA}` },
  });
  const lessons = (await sR.json()).data || [];
  const lesson = lessons.find(l => l.status === "scheduled");
  expect(lesson).toBeTruthy();
  console.log("  found lesson:", lesson.id, "at", lesson.scheduled_at);

  // 改时间到 +3 天, 同 hour:minute
  const oldDate = new Date(lesson.scheduled_at);
  const newDate = new Date(oldDate.getTime() + 3 * 86400_000);
  const newIso = newDate.toISOString();

  const pR = await requestCtx.patch(`https://api.17say.org/lessons/${lesson.id}`, {
    headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" },
    data: { scheduled_at: newIso },
  });
  expect(pR.status()).toBe(200);
  const pJ = await pR.json();
  // supabase 返 ISO 格式可能无 .000Z, 比较 epoch ms
  expect(new Date(pJ.data.scheduled_at).getTime()).toBe(new Date(newIso).getTime());
  console.log("  PATCH success, new time:", pJ.data.scheduled_at);

  // 还原
  await requestCtx.patch(`https://api.17say.org/lessons/${lesson.id}`, {
    headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" },
    data: { scheduled_at: lesson.scheduled_at },
  });
});

test("v2 PATCH /lessons/:id 冲突检测 (同时间同老师)", async ({ request: requestCtx }) => {
  const tA = await token(requestCtx, ADMIN);

  // 找 2 个 lesson
  const today = new Date();
  const from = new Date(today.getTime() - 14 * 86400_000).toISOString();
  const to = new Date(today.getTime() + 14 * 86400_000).toISOString();
  const sR = await requestCtx.get(`https://api.17say.org/schedules?from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${tA}` },
  });
  const lessons = (await sR.json()).data || [];
  const aliceLessons = lessons.filter(l =>
    l.status === "scheduled" && l.profiles?.email === "alice.t@17say.org"
  );
  if (aliceLessons.length < 2) {
    console.log("  skip: need 2 alice lessons");
    test.skip();
    return;
  }
  const [l1, l2] = aliceLessons;
  console.log("  trying conflict: move", l2.id, "to", l1.scheduled_at);

  const pR = await requestCtx.patch(`https://api.17say.org/lessons/${l2.id}`, {
    headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" },
    data: { scheduled_at: l1.scheduled_at },
  });
  expect(pR.status()).toBe(409);
  const err = await pR.json();
  expect(err.code).toBe("SCHEDULE_CONFLICT");
  console.log("  conflict detected OK, code:", err.code);
});
