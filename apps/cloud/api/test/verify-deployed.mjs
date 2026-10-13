// 只读: 验证部署后的两个修复点 + health。
const BASE = "https://api.17say.org";
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://17say.org" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).data.access_token;
}
let pass = 0;
let fail = 0;
const expect = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  OK  " + name); }
  else { fail++; console.log("  FAIL " + name + " -- " + detail); }
};

// health
const hres = await fetch(`${BASE}/health`);
const hj = await hres.json();
expect("/health 200 ok", hres.status === 200 && hj.data.status === "ok");

const token = await login("admin@17say.org", "Demo1234!");
const h = { authorization: `Bearer ${token}`, origin: "https://17say.org" };
const getj = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: h });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, raw: t.slice(0, 150) };
};

// 修复1: payroll 用 YYYY-MM 不再 500
const pay = await getj("/finance/payroll?from=2026-05");
expect("payroll?from=2026-05 为 200(原 500)", pay.status === 200, pay.raw);

// 非法月份应 400(不再 500)
const bad = await getj("/finance/payroll?from=not-a-month");
expect("payroll 非法入参 400(不再 500)", bad.status === 400, `实际 ${bad.status}`);

// 修复2: leave 返回 { items }
const lv = await getj("/leave?status=pending&limit=50");
expect("leave 返回对象且含 items 数组", lv.status === 200 && Array.isArray(lv.j.data.items), lv.raw);

console.log(`\n验证: ${pass} 通过, ${fail} 失败`);
if (fail) process.exitCode = 1;
