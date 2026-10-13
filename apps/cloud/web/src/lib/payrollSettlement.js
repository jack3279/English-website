export function findPayrollSettlement(row, records = []) {
  return records.find(
    (r) =>
      r.teacher_id === row.teacher_id &&
      (row.period_from
        ? (r.from === row.period_from &&
            r.to === row.period_to &&
            r.currency === row.pay_currency) ||
          (row.period === "monthly" &&
            !r.from &&
            r.month === row.period_from.slice(0, 7) &&
            r.currency === row.pay_currency)
        : r.month === String(row.month).slice(0, 7)),
  );
}
export function payrollSettlementChanged(row, record) {
  return (
    record?.state === "paid" &&
    (record.amount_cents !== Math.round(Number(row.pay_amount || 0) * 100) ||
      record.currency !== row.pay_currency ||
      (row.lesson_ids &&
        record.lesson_ids &&
        JSON.stringify([...row.lesson_ids].sort()) !==
          JSON.stringify([...record.lesson_ids].sort())))
  );
}
