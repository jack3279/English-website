import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";

const METHODS = ["微信", "支付宝", "银行转账", "现金", "其他"];

export default function RefundPackageDialog({ student, onClose, onSubmit, submitting, err }) {
  const packages = useMemo(
    () => (student.packages ?? []).filter((p) => Number(p.remaining_hours) > 0),
    [student.packages],
  );
  const [packageId, setPackageId] = useState(packages[0]?.id || "");
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(METHODS[0]);
  const [notes, setNotes] = useState("");

  const picked = packages.find((p) => p.id === packageId) || null;
  const left = picked
    ? Math.min(Number(picked.remaining_hours), Math.max(0, Number(student.remaining_hours ?? 0)))
    : 0;
  const hoursNum = Number(hours);
  const amountNum = Number(amount);
  const hoursValid = Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= left + 0.001;
  const amountValid = amount !== "" && Number.isFinite(amountNum) && amountNum >= 0;
  const canSubmit = !!picked && hoursValid && amountValid && notes.trim().length > 0 && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      student_package_id: picked.id,
      hours: Math.round(hoursNum * 100) / 100,
      amount_cents: Math.round(amountNum * 100),
      method,
      notes: notes.trim(),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="办理退费"
      description={`${student.full_name} · 从指定课时包扣剩余课时并记录退款`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {submitting ? "提交中…" : "确认退费"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {packages.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 ">
            这个学员没有剩余课时，不能退费。
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="refund-pkg">课时包</Label>
              <Select
                id="refund-pkg"
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
              >
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.package_types?.name || "课时包"} · 剩余 {Number(p.remaining_hours)}h
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="refund-hours">退课时</Label>
                <Input
                  id="refund-hours"
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder={`最多 ${left}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">退款金额（元）</Label>
                <Input
                  id="refund-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0 表示只退课时"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-method">退款方式</Label>
              <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-notes">原因</Label>
              <Input
                id="refund-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="例: 家长停课，退还未上课时"
                required
              />
            </div>
            <div className="flex items-start gap-1.5 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-800 dark:border-warning-900 dark:bg-warning-900/25 dark:text-warning-200">
              <Undo2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>确认后会从该课时包扣掉剩余课时，并记一笔退款。已上过的课不会被改掉。</span>
            </div>
          </>
        )}
        {err && (
          <p className="text-sm text-danger-600 dark:text-danger-300 ">
            {err.message || "退费失败"}
          </p>
        )}
      </div>
    </Dialog>
  );
}
