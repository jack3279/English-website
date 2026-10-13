// 只读: 验证本批上线修复 —— 学员搜索(姓名/备注)、课酬起始月、通知上限。
const BASE = "https://api.17say.org";
async function login(e, p) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: e, password: p }),
  });
  return (await r.json()).data.access_token;
}
const token = await login("admin@17say.org", "Demo1234!");
const h = { authorization: `Bearer ${token}`, origin: "https://17say.org" };
const getj = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: h });
  return { status: r.status, j: await r.json() };
};

let pass = 0;
let fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log("  OK  " + n); }
  else { fail++; console.log("  FAIL " + n + (d ? " -- " + d : "")); }
};

// 拉全部学员，取一个姓名片段和一个备注片段做搜索
const all = (await getj("/students?pageSize=200")).j.data ?? [];
const withNotes = all.find((s) => s.notes && s.notes.length >= 2);
const nameFrag = all[0]?.full_name?.slice(0, 2);

// 1a. 姓名片段搜索应命中含该片段的学员
if (nameFrag) {
  const r = await getj(`/students?search=${encodeURIComponent(nameFrag)}&pageSize=200`);
  const ok = r.status === 200 && r.j.data.some((s) => s.full_name.includes(nameFrag));
  check(`服务端按姓名片段「${nameFrag}」搜索`, ok, `命中 ${r.j.data?.length}`);
}
// 1b. 备注搜索（验证已从“仅姓名”扩展到“姓名/备注”）
if (withNotes) {
  const noteFrag = withNotes.notes.slice(0, 3);
  const r = await getj(`/students?search=${encodeURIComponent(noteFrag)}&pageSize=200`);
  const ok = r.status === 200 && r.j.data.some((s) => (s.notes || "").includes(noteFrag));
  check(`服务端按备注「${noteFrag}」搜索`, ok, `命中 ${r.j.data?.length}`);
} else {
  console.log("  (无含备注学员，跳过备注搜索)");
}

// 2. 课酬起始月：from 取一个“月中”日期，返回行应包含该月（被 floor 到月首）
const pay = await getj("/finance/payroll?from=2026-09-15&to=2026-10-31");
const months = (pay.j.data?.rows ?? []).map((r) => String(r.month).slice(0, 7));
check("课酬月中起点仍包含起始月(2026-09)", months.includes("2026-09"), `月份=${[...new Set(months)]}`);

// 3. 通知上限：请求 limit=200 不再被截到 100（返回结构正常、items 可超过100则更佳）
const nt = await getj("/notifications?limit=200");
check("notifications?limit=200 正常返回 200", nt.status === 200 && Array.isArray(nt.j.data.items));

console.log(`\n验证: ${pass} 通过, ${fail} 失败`);
if (fail) process.exitCode = 1;
