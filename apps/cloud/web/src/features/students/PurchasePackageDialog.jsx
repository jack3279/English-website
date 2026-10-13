import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Info } from "lucide-react";
import { http } from "../../lib/http.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";

const METHODS = ["微信", "支付宝", "银行转账", "现金", "其他"];

// 有效期快捷项。允许不设 —— 有些家长买的是"不限期"的包，硬性要求反而会被乱填。
const DURATIONS = [
  { key: "none", label: "不设有效期" },
  { key: "3", label: "3 个月" },
  { key: "6", label: "6 个月" },
  { key: "12", label: "12 个月" },
];

const yuan = (cents) => (Number(cents || 0) / 100).toFixed(2);

// 今天 + n 个月，返回 YYYY-MM-DD（按本地日历日，服务端会解释成当天 23:59:59 +08:00）
function plusMonths(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PurchasePackageDialog({ student, onClose, onSubmit, submitting, err }) {
  const { data: types = [] } = useQuery({
    queryKey: ["package-types"],
    queryFn: async () => (await http("/packages/types")).data ?? [],
  });
  const active = useMemo(() => types.filter((t) => t.active !== false), [types]);

  const [typeId, setTypeId] = useState("");
  const [amount, setAmount] = useState(""); // 元
  const [method, setMethod] = useState(METHODS[0]);
  const [duration, setDuration] = useState("none");
  const [notes, setNotes] = useState("");

  const picked = active.find((t) => t.id === typeId) || null;
  const listCents = picked ? Number(picked.price_cents || 0) : 0;
  const amountCents = amount === "" ? listCents : Math.round(Number(amount) * 100);
  const discounted = picked && amount !== "" && amountCents !== listCents;
  const amountValid = Number.isFinite(amountCents) && amountCents >= 0;

  const submit = () => {
    if (!picked || !amountValid) return;
    onSubmit({
      student_id: student.id,
      package_type_id: picked.id,
      amount_cents: amountCents,
      method,
      notes: notes.trim() || null,
      expires_at: duration === "none" ? null : plusMonths(Number(duration)),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="购买课时包"
      description={`${student.full_name} · 当前剩余 ${student.remaining_hours ?? 0}h`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={submitting || !picked || !amountValid} onClick={submit}>
            {submitting ? "提交中..." : "确认购买"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {active.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-300 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-md p-3">
            还没有可售的课时包。「课时包」页面先建一个，或者把已下架的重新上架。
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-type">课时包 *</Label>
              <Select
                id="pkg-type"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setAmount(""); // 换套餐就回到原价，避免把上一个套餐的折扣金额带过来
                }}
              >
                <option value="">请选择…</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.hours}h · ¥{yuan(t.price_cents)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pkg-amount">实收金额 (元) *</Label>
              <Input
                id="pkg-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={picked ? `默认原价 ${yuan(listCents)}` : "先选课时包"}
              />
              {picked && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {discounted ? (
                    <span className="text-warning-600 dark:text-warning-400">
                      实收 ¥{yuan(amountCents)}，比原价少 ¥{yuan(listCents - amountCents)}
                    </span>
                  ) : (
                    <span>原价 ¥{yuan(listCents)}</span>
                  )}
                  <span className="mx-1">·</span>
                  <span>
                    每课时 ¥{picked.hours > 0 ? (amountCents / 100 / picked.hours).toFixed(2) : "—"}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pkg-method">收款方式</Label>
                <Select id="pkg-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkg-duration">有效期</Label>
                <Select
                  id="pkg-duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                >
                  {DURATIONS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {duration !== "none" && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                到期日 {plusMonths(Number(duration))}（当天 23:59 前有效）。 到期前 30
                天会进入续费提醒。
              </div>
            )}
            {duration === "none" && (
              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                不设有效期时，系统只在「剩余课时快用完」时提醒，不会按日期提醒。
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pkg-notes">备注</Label>
              <Input
                id="pkg-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="例: 老学员优惠 / 含教材费"
              />
            </div>

            <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-md p-3 text-xs text-primary-700 dark:text-primary-300 flex items-start gap-1.5">
              <GraduationCap className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                确认后会同时生成<b>课时包</b>与<b>缴费记录</b>（两件事一起成功或一起失败）。
                课时数按套餐设定，直接进入学员余额，可以马上开始消课。
              </span>
            </div>

            {err && (
              <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
                {err.message}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
