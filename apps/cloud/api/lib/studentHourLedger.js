const { getAdmin } = require("./supabase.js");
const { HttpError } = require("./errors.js");
async function all(table, select, id) {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const r = await getAdmin()
      .from(table)
      .select(select)
      .eq("student_id", id)
      .order("id")
      .range(offset, offset + 499);
    if (r.error) throw new HttpError(503, "LEDGER_UNAVAILABLE", "课时账单读取失败，请稍后重试");
    rows.push(...(r.data || []));
    if ((r.data || []).length < 500) return rows;
  }
  throw new HttpError(400, "LEDGER_TOO_LARGE", "历史记录过多，请联系管理员导出");
}
async function build(id) {
  const [txs, packs, balance] = await Promise.all([
    all("lesson_transactions", "id,delta,reason,note,created_at,lesson_id", id),
    all(
      "student_packages",
      "id,total_hours,remaining_hours,purchased_at,expires_at,package_types(name)",
      id,
    ),
    getAdmin().from("student_balance").select("remaining_hours").eq("student_id", id).maybeSingle(),
  ]);
  if (balance.error || !balance.data)
    throw new HttpError(503, "BALANCE_UNAVAILABLE", "余额读取失败，未显示假余额");
  const lessonMap = new Map(),
    ids = [...new Set(txs.map((t) => t.lesson_id).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await getAdmin()
      .from("lessons")
      .select("id,scheduled_at,status,duration_min")
      .in("id", ids.slice(i, i + 100));
    if (r.error) throw new HttpError(503, "LEDGER_UNAVAILABLE", "上课记录读取失败");
    for (const l of r.data || []) lessonMap.set(l.id, l);
  }
  const events = packs.map((p) => ({
    id: `package-${p.id}`,
    kind: "purchase",
    label: "购买课时",
    delta: Number(p.total_hours),
    at: p.purchased_at,
    note: p.package_types?.name || "课时包",
    expires_at: p.expires_at,
    lesson_id: null,
  }));
  for (const t of txs) {
    const lesson = lessonMap.get(t.lesson_id),
      counted = ["consume", "adjust", "refund"].includes(t.reason);
    events.push({
      id: t.id,
      kind: t.reason,
      label:
        t.reason === "consume"
          ? lesson?.status === "no_show"
            ? "缺席扣课时"
            : "上课扣课时"
          : t.reason === "adjust"
            ? "课时调整"
            : t.reason === "refund"
              ? "退还课时"
              : "历史记录（不参与当前余额）",
      delta: counted ? Number(t.delta) : null,
      at: t.created_at,
      note: t.note || "",
      lesson_id: t.lesson_id,
      lesson: lesson || null,
    });
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    remaining_hours: Number(balance.data.remaining_hours),
    summary: {
      purchased_hours: round(packs.reduce((n, p) => n + Number(p.total_hours), 0)),
      consumed_hours: round(
        -txs.filter((t) => t.reason === "consume").reduce((n, t) => n + Number(t.delta), 0),
      ),
      refunded_hours: round(
        -txs.filter((t) => t.reason === "refund").reduce((n, t) => n + Number(t.delta), 0),
      ),
      adjusted_hours: round(
        txs.filter((t) => t.reason === "adjust").reduce((n, t) => n + Number(t.delta), 0),
      ),
      expiry: packs.map((p) => ({ id: p.id, expires_at: p.expires_at })),
    },
    events: events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))),
  };
}
module.exports = { build };
