// 只读：对全部学员对比「旧余额视图(生产当前)」与「新口径」的数值，验证新视图合理性。
const BASE = "https://api.17say.org";
const r = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@17say.org", password: "Demo1234!" }),
});
const token = (await r.json()).data.access_token;
const h = { authorization: `Bearer ${token}` };
const getj = async (p) => (await fetch(`${BASE}${p}`, { headers: h })).json();

const students = (await getj("/students?pageSize=200")).data ?? [];
console.log("学员".padEnd(22), "旧视图".padStart(8), "新口径".padStart(8), "  包余额 / consume+adjust");
let weird = 0;
for (const s of students) {
  const d = (await getj(`/students/${s.id}`)).data;
  const pkgSum = (d.packages ?? []).reduce(
    (a, p) => a + Number(p.remaining_hours || 0),
    0,
  );
  const txAdj = (d.transactions ?? [])
    .filter((t) => ["consume", "adjust"].includes(t.reason))
    .reduce((a, t) => a + Number(t.delta || 0), 0);
  const neu = Math.round((pkgSum + txAdj) * 100) / 100;
  const old = Number(d.remaining_hours);
  const flag = neu < -50 ? "  <== 异常" : "";
  if (neu < -50) weird++;
  console.log(
    (s.full_name || "?").slice(0, 20).padEnd(22),
    String(old).padStart(8),
    String(neu).padStart(8),
    `   ${Math.round(pkgSum * 100) / 100} / ${Math.round(txAdj * 100) / 100}${flag}`,
  );
}
console.log("\n异常(<-50h)学员数:", weird);
