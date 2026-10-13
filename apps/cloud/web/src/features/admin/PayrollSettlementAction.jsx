import { findPayrollSettlement, payrollSettlementChanged } from "../../lib/payrollSettlement.js";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { http } from "../../lib/http.js";
export default function PayrollSettlementAction({ row, records, disabled }) {
  const qc = useQueryClient(),
    [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const period = row.period_from
    ? `${row.period_from} 至 ${row.period_to}`
    : String(row.month).slice(0, 7);
  const record = findPayrollSettlement(row, records);
  const legacyRecord = row.period_from && record && !record.from;
  const paid = record?.state === "paid",
    changed = payrollSettlementChanged(row, record);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await http(
        row.period_from && !legacyRecord
          ? "/finance/payroll/period-settlements"
          : "/finance/payroll/settlements",
        {
          method: "POST",
          body: {
            teacher_id: row.teacher_id,
            ...(row.period_from && !legacyRecord
              ? { period: row.period, from: row.period_from, to: row.period_to }
              : { month: legacyRecord ? record.month : period }),
            mode: paid ? "retract" : "mark",
            note,
            confirmed,
            current_password: password,
            expected_amount_cents: Math.round(Number(row.pay_amount || 0) * 100),
            expected_currency: row.pay_currency,
          },
        },
      );
      await qc.invalidateQueries({ queryKey: ["finance", "payroll", "settlements"] });
      await qc.invalidateQueries({ queryKey: ["payroll", "report"] });
      setOpen(false);
      setPassword("");
      setConfirmed(false);
    } catch (e) {
      setError(e.message || "登记失败，请核对状态后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Badge variant={changed ? "warning" : paid ? "success" : "secondary"}>
        {changed ? "金额或课程变化待核对" : paid ? "已登记发放" : "待登记"}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || (!paid && (!row.pay_currency || Number(row.pay_amount) <= 0))}
        onClick={() => {
          setError("");
          setNote("");
          setPassword("");
          setConfirmed(false);
          setOpen(true);
        }}
      >
        {paid ? "撤销登记" : "登记已发放"}
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => !busy && setOpen(false)}
          title={paid ? "撤销发放登记" : "登记课酬已发放"}
          description={`${row.teacher_name} · ${period} · ${Number(row.pay_amount || 0).toFixed(2)} ${row.pay_currency || ""}`}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </Button>
              <Button
                onClick={submit}
                disabled={busy || !confirmed || !password || (paid && note.trim().length < 2)}
              >
                {busy ? "处理中…" : "确认记录"}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            此操作只记录外部发放情况，不执行转账，也不修改课节、课时或历史课酬快照。撤销会保留原登记历史。
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor={`payroll-note-${row.teacher_id}-${period}`}>
                {paid ? "撤销原因（必填）" : "备注（选填）"}
              </Label>
              <Input
                id={`payroll-note-${row.teacher_id}-${period}`}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`payroll-password-${row.teacher_id}-${period}`}>当前管理员密码</Label>
              <Input
                id={`payroll-password-${row.teacher_id}-${period}`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>
                {paid ? "我已核对，需更正登记记录" : "我确认已通过外部渠道实际发放该月份课酬"}
              </span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger-700 dark:text-danger-300">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
