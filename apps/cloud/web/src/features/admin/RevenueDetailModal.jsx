import { Link } from "react-router-dom";
import { Receipt, Calendar, User, CreditCard, FileText, Hash, Copy } from "lucide-react";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useToast } from "../../components/ui/toast.jsx";

function yuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 单笔缴费详情弹窗。
 * 营收明细页点开一行触发。
 *
 * 数据来源: FinancePage 已加载的 revenue.rows 一行 (含 student_id / package_name / method / notes)
 * —— 没必要再发一次接口,直接复用 props。
 */
export default function RevenueDetailModal({ row, onClose }) {
  const toast = useToast();
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary-700 dark:text-primary-300 " />
          <span>缴费详情</span>
        </div>
      }
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* 金额大字 */}
        <div className="rounded-lg bg-primary-50 dark:bg-primary-900/30 px-4 py-3 text-center">
          <div className="text-xs text-primary-700 dark:text-primary-300 mb-1">本笔金额</div>
          <div className="text-3xl font-bold text-primary-700 dark:text-primary-200">
            ¥{yuan(row.amount_cents)}
          </div>
          <div className="text-xs text-primary-700 dark:text-primary-300 mt-1">
            {row.method || "未填写支付方式"}
          </div>
        </div>

        {/* 字段表 */}
        <div className="space-y-2.5">
          <Field icon={Calendar} label="缴费时间">
            {fmtDateTime(row.paid_at)}
          </Field>
          <Field icon={User} label="学员">
            <Link
              to={`/students/${row.student_id}`}
              className="text-primary-700 dark:text-primary-400 hover:underline font-medium"
              onClick={onClose}
            >
              {row.student_name}
            </Link>
          </Field>
          <Field icon={Receipt} label="课时包">
            {row.package_name || "—"}
          </Field>
          <Field icon={CreditCard} label="支付方式">
            {row.method || "—"}
          </Field>
          {row.notes && (
            <Field icon={FileText} label="备注">
              <span className="whitespace-pre-wrap">{row.notes}</span>
            </Field>
          )}
          <Field icon={Hash} label="记录 ID">
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{row.id}</span>
            <button
              type="button"
              className="ml-2 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-400 "
              onClick={() => {
                navigator.clipboard?.writeText(row.id);
                toast.success("已复制 ID");
              }}
              aria-label="复制 ID"
            >
              <Copy className="w-3 h-3 inline" />
            </button>
          </Field>
        </div>

        {/* 操作 */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button asChild>
            <Link to={`/students/${row.student_id}`} onClick={onClose}>
              查看学员详情 →
            </Link>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
        <div className="text-gray-900 dark:text-gray-100">{children}</div>
      </div>
    </div>
  );
}
