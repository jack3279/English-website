import { useState } from "react";
import { CalendarX, Clock } from "lucide-react";
import { http } from "../../lib/http.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Label } from "../../components/ui/label.jsx";
import { useInstitution } from '../admin/InstitutionContext.jsx';

export default function LeaveRequestModal({ lesson, onClose, onDone }) {
  const { rules, loading, error: rulesError } = useInstitution();
  const deadline = new Date(Date.parse(lesson.scheduled_at) - Number(rules.leaveDeadlineHours || 0) * 3600000);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await http(`/parent/lessons/${lesson.id}/leave`, { method: "POST", body: { reason } });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const dt = new Date(lesson.scheduled_at);

  return (
    <Dialog
      open
      onClose={onClose}
      title="请假申请"
      description={
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {dt.toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            weekday: "short",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="leave-form" disabled={submitting || loading || !!rulesError || !reason.trim()}>
            {submitting ? "提交中…" : "提交请假"}
          </Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-md p-3 text-sm">
          <CalendarX className="w-4 h-4 text-warning-600 dark:text-warning-400 shrink-0 mt-0.5" />
          <div className="text-warning-700 dark:text-warning-300">
            请假最晚提前 {Math.round((rules.leaveDeadlineHours || 0) * 60)} 分钟提交，截止时间：{deadline.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}。截止前提交按请假审批；超时未上课按缺勤处理，扣课时和课酬由管理员确认。
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leave-reason">原因 *</Label>
          <Textarea
            id="leave-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            placeholder="请说明请假原因 (例: 孩子感冒发烧 / 临时有事)"
          />
        </div>
        {err && (
          <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
            {err}
          </div>
        )}
      </form>
    </Dialog>
  );
}
