// 业务流: 完成一节课, 验证状态/课后记录/家长动态等副作用。开发期可直接跑。
const BASE = "https://api.17say.org";
const MARK = "__SMOKE__完课";

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).data.access_token;
}
const token = await login("admin@17say.org", "Demo1234!");
const h = { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "https://17say.org" };
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, j, raw: text.slice(0, 300) };
};
const ok2 = [];
const check = (n, c, d = "") => { ok2.push([n, c]); console.log(`  ${c ? "OK  " : "FAIL"} ${n}${d ? " -- " + d : ""}`); };

// 1. 找一节 scheduled 课
const sch = await call("GET", "/schedules?from=2026-01-01&to=2026-12-31&pageSize=1000");
const rows = sch.j.data?.rows ?? sch.j.data ?? [];
const lesson = rows.find((r) => r.status === "scheduled");
if (!lesson) {
  console.log("没有 scheduled 课可测，跳过");
  process.exit(0);
}
console.log(`选课: ${lesson.id} 学生=${lesson.student_id}`);

// 2. 完课前详情
const before = await call("GET", `/lessons/${lesson.id}`);
check("完课前可查详情", before.ok, before.ok ? "" : before.raw);

// 3. 完课
const c = await call("POST", `/lessons/${lesson.id}/complete`, {
  content: `${MARK} 课后反馈`,
  performance: "课堂表现良好",
  homework: "完成练习册 P10",
  next_plan: "下节课复习 Unit 2",
  publishToParent: true,
});
check("完课返回 200", c.ok, c.ok ? `newBalance=${c.j?.data?.newBalance}` : c.raw);

// 4. 再查详情 → completed
const after = await call("GET", `/lessons/${lesson.id}`);
const done = after.j?.data?.status === "completed";
check("课节状态变为 completed", done, `实际=${after.j?.data?.status}`);

// 5. 幂等: 再完课一次应 200 且 alreadyCompleted
const again = await call("POST", `/lessons/${lesson.id}/complete`, { content: "重复" });
check("重复完课幂等", again.ok && again.j?.data?.alreadyCompleted, again.ok ? "" : again.raw);

// 6. 家长动态包含该反馈
const feeds = await call("GET", `/parent/feeds?studentId=${lesson.student_id}&pageSize=10`);
const feedRows = feeds.j?.data?.items ?? feeds.j?.data ?? [];
const inFeed = (Array.isArray(feedRows) ? feedRows : []).some((f) => (f.content || f.body || "").includes(MARK));
check("家长动态可见该反馈", inFeed, feeds.ok ? "" : feeds.raw);

// 7. 学员学习报告可出
const rep = await call("GET", `/students/${lesson.student_id}/report`);
check("学员学习报告 200", rep.ok, rep.ok ? "" : rep.raw);

const failed = ok2.filter(([, c]) => !c);
console.log(`\n完课流: ${ok2.length - failed.length}/${ok2.length} 通过`);
if (failed.length) process.exitCode = 1;
