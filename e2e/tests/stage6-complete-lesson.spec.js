// v2 Stage 6 E2E: 完课 + 流水 + 余额扣减完整业务流 (全 API, 幂等)
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function fetchWithRetry(url, opts, attempts = 8) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || r.status < 500) return r;
      lastErr = `${r.status} ${await r.text().catch(() => "")}`.slice(0, 200);
    } catch (e) {
      lastErr = e.message || "fetch failed";
    }
    const wait = Math.min(12000, 1000 * Math.pow(1.4, i));
    console.log(`  [retry ${i + 1}/${attempts}] ${url.split("/").pop()}: ${lastErr} (wait ${Math.round(wait)}ms)`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return await fetch(url, opts);
}

test("v2 完课完整流程: admin 调 API → lesson completed + student consume + tx (幂等)", async () => {
  // 1. admin login
  const lr = await fetchWithRetry("https://api.17say.org/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  expect(lr.ok).toBeTruthy();
  const token = (await lr.json()).data?.access_token;
  expect(token).toBeTruthy();

  // 2. 找一个 scheduled lesson
  const today = new Date();
  const fromIso = new Date(today.getTime() - 14 * 86400_000).toISOString();
  const toIso = new Date(today.getTime() + 14 * 86400_000).toISOString();
  const sR = await fetchWithRetry(
    `https://api.17say.org/schedules?from=${fromIso}&to=${toIso}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(sR.ok).toBeTruthy();
  const all = (await sR.json()).data || [];
  const target = all.find((l) => l.status === "scheduled");
  if (!target) {
    console.log("  no scheduled lesson in ±2 weeks, skipping");
    test.skip();
    return;
  }
  console.log("  target lesson:", target.id, "student:", target.student_id, "duration:", target.duration_min, "min");

  // 3. 拿初始 tx count
  const beforeR = await fetchWithRetry(
    `https://api.17say.org/students/${target.student_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const before = (await beforeR.json()).data;
  const beforeTxCount = (before.transactions ?? []).length;
  const hadConsume = (before.transactions ?? []).some(
    (t) => t.reason === "consume" && t.lesson_id === target.id
  );
  console.log("  before: hours =", before.remaining_hours, "tx count =", beforeTxCount, "had consume:", hadConsume);

  // 4. 完课 (幂等: 已完成 返 alreadyCompleted=true)
  const completeR = await fetchWithRetry(
    `https://api.17say.org/lessons/${target.id}/complete`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content: "E2E 自动化完课: 学员表现优秀",
        performance: "excellent",
        homework: "复习单词",
        next_plan: "下节 Lesson 6",
        publishToParent: false,
      }),
    }
  );
  const completeJ = await completeR.json();
  expect(completeR.ok).toBeTruthy();
  expect(completeJ.data?.lessonId).toBe(target.id);
  expect(completeJ.data?.recordId).toBeTruthy();
  console.log("  complete response:", completeJ.data?.alreadyCompleted ? "(already completed)" : "newly completed, balance=" + completeJ.data?.newBalance);

  // 5. 验证: lesson 状态 completed
  const lesR = await fetchWithRetry(
    `https://api.17say.org/lessons/${target.id}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const lesJ = await lesR.json();
  expect(lesJ.data?.status).toBe("completed");
  expect(lesJ.data?.record?.id).toBeTruthy();
  console.log("  lesson status:", lesJ.data?.status, "record id:", lesJ.data?.record?.id);

  // 6. 验证: student 流水 (consume 存在即可, tx count 可能不增 (幂等))
  const afterR = await fetchWithRetry(
    `https://api.17say.org/students/${target.student_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const after = (await afterR.json()).data;
  const txs = after.transactions ?? [];
  const consume = txs.find((t) => t.reason === "consume" && t.lesson_id === target.id);
  expect(consume).toBeTruthy();
  expect(consume.delta).toBeLessThan(0);
  expect(Math.abs(consume.delta)).toBeCloseTo(target.duration_min / 60, 1);
  console.log("  consume tx:", consume.delta, "h for", target.duration_min, "min lesson");

  // 7. record 写入 records (幂等: 之前已 record 则不增; 内容是 first complete 时的)
  expect(lesJ.data?.record?.id).toBeTruthy();
  console.log("  record id:", lesJ.data?.record?.id, "content:", (lesJ.data?.record?.content || "").slice(0, 50));
});
