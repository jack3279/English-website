import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { http } from "../../lib/http.js";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { useToast } from "../../components/ui/toast.jsx";

// 后端 purge_student(_preview) 返回的计数字段 -> 中文说明。
const COUNT_LABELS = {
  lessons: "课节",
  records: "课后反馈",
  parent_feeds: "家长可见动态",
  lesson_transactions: "课时流水",
  package_payments: "缴费记录",
  student_packages: "课时包",
  parent_student_links: "家长关联",
  leave_requests: "请假申请",
  makeups: "补课记录",
  notifications: "站内通知",
  notification_reads: "通知已读",
  materials: "定向教材",
};
const COUNT_ORDER = Object.keys(COUNT_LABELS);

export default function DeleteStudentDialog({ student, onClose, onDeleted }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const preview = useQuery({
    queryKey: ["student-delete-preview", student?.id],
    enabled: !!student?.id,
    queryFn: async () =>
      (await http(`/students/${student.id}/delete-preview`, { method: "POST" })).data,
  });

  const del = useMutation({
    mutationFn: () =>
      http(`/students/${student.id}`, {
        method: "DELETE",
        body: { confirmed: true, current_password: password },
      }),
    onSuccess: (resp) => {
      toast.success(`已永久删除「${student.full_name}」及其关联数据`);
      onDeleted?.(resp.data);
    },
    onError: (e) => toast.error(e?.message || "删除失败"),
  });

  const counts = preview.data || {};
  const affected = COUNT_ORDER.map((k) => ({ k, n: Number(counts[k] || 0) })).filter(
    (x) => x.n > 0,
  );
  const totalAffected = affected.reduce((s, x) => s + x.n, 0);
  const busy = del.isPending;
  const canSubmit = !!password && confirmed && !busy && !preview.isError;

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title="永久删除学员"
      description={student?.full_name}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => del.mutate()}>
            {busy ? "正在删除…" : "确认永久删除"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex gap-3 rounded-lg border border-danger-200 bg-danger-50 p-3 text-danger-800 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">此操作永久不可恢复，仅用于清理假数据。</p>
            <p>
              会一并删除该学员的课节、课后反馈、课时包、缴费、请假补课、通知和家长关联；
              <b>家长与教师账号本身保留</b>。真实在读学员请改用「停课 / 休学 / 结课 / 退费」状态。
            </p>
          </div>
        </div>

        {preview.isLoading && (
          <p className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在统计将删除的数据…
          </p>
        )}
        {preview.isError && (
          <p role="alert" className="text-danger-700 dark:text-danger-300">
            {preview.error?.message || "删除预览加载失败"}
          </p>
        )}
        {preview.data && (
          <div className="space-y-2">
            <p className="font-medium text-gray-800 dark:text-gray-200">
              将永久删除 {totalAffected} 条关联记录：
            </p>
            {affected.length === 0 ? (
              <p className="text-gray-500">该学员名下没有课节、课时包或缴费等关联数据。</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                {affected.map(({ k, n }) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="text-gray-600 dark:text-gray-300">{COUNT_LABELS[k]}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="delete-current-password" className="font-medium text-gray-700 dark:text-gray-300">
            当前管理员密码
          </label>
          <Input
            id="delete-current-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="重新输入你的管理员密码"
          />
        </div>

        <label className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          <span>
            我确认永久删除该学员及其 {totalAffected} 条关联记录，且知道用删除前的旧备份恢复会把这些数据补回。
          </span>
        </label>

        {del.isError && (
          <p role="alert" className="text-danger-700 dark:text-danger-300">
            {del.error?.message || "删除失败"}
          </p>
        )}
      </div>
    </Dialog>
  );
}
