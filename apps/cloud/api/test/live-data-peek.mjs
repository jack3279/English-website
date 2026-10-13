// 只读: 探查生产业务数据 —— 课节状态分布 / 待上课节 / 学员, 供业务流测试选数据。
const BASE = "https://api.17say.org";
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).data.access_token;
}
const token = await login("admin@17say.org", "Demo1234!");
const h = { authorization: `Bearer ${token}`, origin: "https://17say.org" };
const get = async (p) => (await fetch(`${BASE}${p}`, { headers: h })).json();

// 宽窗口拉课节
const wide = await get("/schedules?from=2026-01-01&to=2026-12-31&pageSize=1000");
const rows = wide.data?.rows ?? wide.data ?? [];
console.log("课节总数(1年窗口):", Array.isArray(rows) ? rows.length : typeof rows);
if (Array.isArray(rows)) {
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log("按状态:", byStatus);
  const sample = rows[0];
  console.log("课节字段样例:", sample && Object.keys(sample).join(","));
  const scheduled = rows.filter((r) => r.status === "scheduled");
  console.log("\n待上(scheduled)课节:");
  for (const l of scheduled.slice(0, 20)) {
    console.log(`  ${l.id} | ${l.scheduled_at} | student=${l.student_name || l.student_id?.slice(0, 8)} | teacher=${l.teacher_name || l.teacher_id?.slice(0, 8)} | dur=${l.duration_min}`);
  }
}
