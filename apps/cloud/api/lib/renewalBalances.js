const { HttpError } = require("./errors.js");

async function loadRenewalPackages(admin, studentIds = null) {
  if (Array.isArray(studentIds) && !studentIds.length) return [];
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    let query = admin
      .from("student_packages")
      .select(
        "id,student_id,total_hours,remaining_hours,expires_at,purchased_at,package_types(name),students(full_name,status)",
      )
      .order("id")
      .range(offset, offset + 499);
    if (Array.isArray(studentIds)) query = query.in("student_id", studentIds);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
  throw new HttpError(503, "RENEWAL_RANGE_TOO_LARGE", "续费资料范围过大，无法安全完成统计");
}

// Package remaining_hours is credit after refunds, not the student's balance
// after attendance deductions. Always obtain the authoritative ledger view.
async function withStudentBalances(admin, packs) {
  const rows = packs || [];
  const ids = [...new Set(rows.map((p) => p.student_id).filter(Boolean))];
  if (!ids.length) return rows;
  const balances = new Map();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await admin
      .from("student_balance")
      .select("student_id,remaining_hours")
      .in("student_id", ids.slice(start, start + 200));
    if (error) throw error;
    for (const row of data || []) {
      const n = Number(row.remaining_hours);
      if (Number.isFinite(n)) balances.set(row.student_id, n);
    }
  }
  return packs.map((p) => {
    if (!balances.has(p.student_id))
      throw new HttpError(503, "BALANCE_UNAVAILABLE", "学员实际课时余额暂时无法确认，请稍后重试");
    return { ...p, student_balance: balances.get(p.student_id) };
  });
}
module.exports = { withStudentBalances, loadRenewalPackages };
