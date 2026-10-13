import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useAuth } from "../auth/useAuth.js";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarX, AlertTriangle, UserCheck, ArrowLeft } from "lucide-react";
import { http } from "../../lib/http.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { useInstitution } from "../admin/InstitutionContext.jsx";
import { useToast } from "../../components/ui/toast.jsx";

/**
 * 点名弹窗：到课 / 请假 / 缺席。
 *  - 到课：调用 onPresent()，由父组件打开完课弹窗（扣课时、填反馈）。
 *  - 请假：必填原因，不扣课时。
 *  - 缺席：二次确认，不扣课时。
 */
export default function AttendanceModal({ lesson, onClose, onPresent }) {
  useUiLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [phase, setPhase] = useState(lesson.attendance ? "absent" : "choose"); // choose | leave | absent
  const [reason, setReason] = useState(lesson.attendance?.choice?.reason || "");
  const {
    rules,
    loading: rulesLoading,
    error: rulesError,
    refresh: refreshRules,
  } = useInstitution();
  const [deductChoice, setDeductChoice] = useState(lesson.attendance?.choice?.deduct_hours ?? null);
  const deduct = lesson.attendance
    ? (lesson.attendance.choice?.deduct_hours ?? false)
    : user?.role === "admin"
      ? (deductChoice ?? rules.absenceDeductHours ?? false)
      : false;
  const hours = Math.round((Number(lesson.duration_min || 60) / 60) * 100) / 100;
  const mutation = useMutation({
    mutationFn: (body) =>
      http(`/lessons/${lesson.id}/attendance`, {
        method: "POST",
        body,
      }),
    onSuccess: async (_d, vars) => {
      await qc.invalidateQueries({
        queryKey: ["schedules"],
      });
      await qc.invalidateQueries({
        queryKey: ["lesson-detail", lesson.id],
      });
      for (const key of [
        ["student", lesson.student_id],
        ["students"],
        ["student-hour-ledger"],
        ["my-students"],
        ["alerts"],
        ["makeups"],
        ["operations"],
        ["payroll"],
        ["teacher-home-payroll"],
      ])
        await qc.invalidateQueries({
          queryKey: key,
        });
      toast.success(vars.result === "leave" ? uiT("已登记请假") : uiT("已登记缺席"));
      onClose();
    },
    onError: (e) => toast.error(e?.message || uiT("点名失败")),
  });
  const submitLeave = () => {
    const text = reason.trim();
    if (!text) {
      toast.error(uiT("请填写请假原因"));
      return;
    }
    mutation.mutate({
      result: "leave",
      reason: text,
    });
  };
  return (
    <Dialog open onClose={onClose} title={uiT("点名")} size="md" layer={1}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(lesson.scheduled_at).toLocaleString(uiLocale(), {
            timeZone: "Asia/Shanghai",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}{" "}
          · {lesson.students?.full_name || uiT("学员")}
        </div>

        {phase === "choose" && (
          <div className="grid sm:grid-cols-3 gap-2">
            <Choice
              icon={UserCheck}
              title={uiT("到课")}
              hint={uiT("正常上课，完课扣课时")}
              tone="text-success-600 border-success-200 hover:bg-success-50 dark:border-success-800 dark:hover:bg-success-900/30 dark:text-success-300 "
              onClick={() => onPresent(lesson)}
            />
            <Choice
              icon={CalendarX}
              title={uiT("请假")}
              hint={uiT("登记原因，不扣课时")}
              tone="text-gray-600 border-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800/50"
              onClick={() => setPhase("leave")}
            />
            <Choice
              icon={AlertTriangle}
              title={uiT("缺勤")}
              hint={uiT("可选择扣或不扣课时")}
              tone="text-danger-600 border-danger-200 hover:bg-danger-50 dark:border-danger-800 dark:hover:bg-danger-900/30 dark:text-danger-300 "
              onClick={() => setPhase("absent")}
            />
          </div>
        )}

        {phase === "leave" && (
          <div className="space-y-2">
            <Back onClick={() => setPhase("choose")} />
            <label htmlFor="attendance-reason" className="text-xs text-gray-500 dark:text-gray-400">
              {" " + uiT("请假原因") + " "}
              <span className="text-danger-500">*</span>
            </label>
            <Textarea
              id="attendance-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={uiT("如：孩子发烧、家中有事…")}
              rows={3}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>
                {" " + uiT("取消") + " "}
              </Button>
              <Button onClick={submitLeave} disabled={mutation.isPending || !reason.trim()}>
                {" " + uiT("确认请假") + " "}
              </Button>
            </div>
          </div>
        )}

        {phase === "absent" && (
          <div className="space-y-3">
            {!lesson.attendance && <Back onClick={() => setPhase("choose")} />}
            <div className="flex items-start gap-3 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-900/20 p-3">
              <AlertTriangle className="w-5 h-5 text-danger-600 shrink-0 mt-0.5 dark:text-danger-300 " />
              <div className="text-sm text-danger-700 dark:text-danger-300">
                {" " + uiT("确认该学员")}
                <b>{uiT("缺席")}</b>
                {uiT("？本次")}
                {deduct ? uiT("扣除 {0} 小时", [hours]) : uiT("不扣课时")}
                {" " +
                  uiT(
                    user?.role === "admin"
                      ? "管理员独立确认是否扣学生课时及是否计教师课酬。"
                      : "缺勤登记后由管理员确认结算，暂不扣课时、暂不计课酬。",
                  ) +
                  " "}
              </div>
            </div>
            {user?.role === "admin" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={deduct}
                  disabled={mutation.isPending || !!lesson.attendance || user?.role !== "admin"}
                  onChange={(e) => setDeductChoice(e.target.checked)}
                />
                {" " + uiT("本次扣除学生课时（")}
                {hours}
                {uiT("小时）") + " "}
              </label>
            )}
            <label htmlFor="absence-reason" className="block text-sm">
              {" " + uiT("缺席原因／扣课说明")}
              {deduct ? uiT("（必填）") : uiT("（选填）")}
            </label>
            <Textarea
              id="absence-reason"
              disabled={mutation.isPending || !!lesson.attendance}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={uiT("如：未提前请假，按约定扣课时")}
              rows={3}
            />
            {rulesError && (
              <p role="alert" className="text-danger-600 dark:text-danger-300">
                {" " + uiT("考勤规则读取失败。") + " "}
                <button type="button" className="underline" onClick={refreshRules}>
                  {" " + uiT("重试") + " "}
                </button>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {" " + uiT("取消") + " "}
              </Button>
              <Button
                onClick={() =>
                  mutation.mutate({
                    result: "no_show",
                    deduct_hours: deduct,
                    reason: reason.trim(),
                  })
                }
                disabled={
                  mutation.isPending || rulesLoading || !!rulesError || (deduct && !reason.trim())
                }
                className="bg-danger-600 hover:bg-danger-700 text-white"
              >
                {" " + uiT("确认缺席") + " "}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
function Choice({ icon: Icon, title, hint, tone, onClick }) {
  useUiLanguage();
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl border p-4 transition ${tone}`}
    >
      <Icon className="w-6 h-6" />
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-[11px] text-gray-500 dark:text-gray-400 text-center">{hint}</span>
    </button>
  );
}
function Back({ onClick }) {
  useUiLanguage();
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-400 "
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {" " + uiT("返回") + " "}
    </button>
  );
}
