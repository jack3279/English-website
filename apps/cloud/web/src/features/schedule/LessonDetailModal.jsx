import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import LessonCorrectionDialog from "../lessons/LessonCorrectionDialog.jsx";
import LessonCompleteModal from "../lessons/LessonCompleteModal.jsx";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Clock,
  CheckCircle2,
  X,
  Trash2,
  Calendar,
  AlertTriangle,
  Loader2,
  BookOpen,
  Award,
  GraduationCap,
  Target,
  Link2,
} from "lucide-react";
import { http } from "../../lib/http.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { useAuth } from "../auth/useAuth.js";
import AttendanceModal from "../lessons/AttendanceModal.jsx";
import RescheduleDialog from "./RescheduleDialog.jsx";
const STATUS_LABEL = () => ({
  scheduled: {
    label: uiT("已排"),
    tone: "default",
    icon: Clock,
  },
  completed: {
    label: uiT("已完成"),
    tone: "success",
    icon: CheckCircle2,
  },
  cancelled: {
    label: uiT("已取消"),
    tone: "secondary",
    icon: X,
  },
  no_show: {
    label: uiT("缺席"),
    tone: "warning",
    icon: AlertTriangle,
  },
});
const LEAVE_LABEL = () => ({
  pending: uiT("待审批"),
  approved: uiT("已批准"),
  rejected: uiT("已拒绝"),
});
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 课节详情弹窗 — 点击排课的任意一节课触发。
 *
 * 操作权限:
 *   scheduled: 改期(admin / 该课 teacher)、标记完成(admin / 该课 teacher)、取消(admin)
 *   completed / cancelled / no_show: 只读
 */
export default function LessonDetailModal({ lessonId, onClose }) {
  useUiLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [correctionOpen,setCorrectionOpen]=useState(false);

  // 详情 (lesson + record)
  // error 必须解构出来：否则接口 500 时 isLoading=false && !lesson → 条件恒真 → 弹窗永久转圈。
  const {
    data: lesson,
    isLoading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["lesson-detail", lessonId],
    queryFn: async () => (await http(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

  // 取消课节
  const cancelMutation = useMutation({
    mutationFn: () =>
      http(`/schedules/${lessonId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(uiT("课节已取消"));
      qc.invalidateQueries({
        queryKey: ["schedules"],
      });
      qc.invalidateQueries({
        queryKey: ["lesson-detail", lessonId],
      });
      onClose();
    },
    onError: (e) => toast.error(e?.message || uiT("取消失败")),
  });

  // 标记完成 (POST /lessons/:id/complete)
  const completeMutation = useMutation({
    mutationFn: (body) =>
      http(`/lessons/${lessonId}/${body.result ? "roll-call" : "complete"}`, {
        method: "POST",
        body,
      }),
    onSuccess: (r) => {
      if (r?.data?.classified_as_absent) toast.info(uiT('未在截止前请假，已登记为缺勤，结算待管理员确认。'));
      if (r?.data?.parentFeedPublished === false && !r?.data?.alreadyCompleted)
        toast.error(uiT("完课已记录，上课确认尚未发出，请从待办补发，不会重复扣课。"));
      const newBal = r?.data?.newBalance;
      toast.success(
        r?.data?.result ? uiT("点名及上课记录已保存") : newBal != null ? uiT("已完成 · 余额剩 {0}h", [newBal.toFixed(1)]) : uiT("课节已标记完成"),
      );
      qc.invalidateQueries({
        queryKey: ["schedules"],
      });
      qc.invalidateQueries({
        queryKey: ["lesson-detail", lessonId],
      });
      // 余额随消课变化，但余额数据来自 ["student", id]（见 StudentDetailPage）。
      // 曾写成不存在的 ["student-balance"] → 标记完成后余额不刷新。
      qc.invalidateQueries({
        queryKey: ["student"],
      });
      qc.invalidateQueries({
        queryKey: ["students"],
      });
      qc.invalidateQueries({
        queryKey: ["alerts"],
      });
      for (const key of [
        ["student-hour-ledger"],
        ["makeups"],
        ["operations"],
        ["payroll"],
        ["teacher-home-payroll"],
      ])
        qc.invalidateQueries({
          queryKey: key,
        });
      setFeedbackOpen(false);
    },
    onError: (e) => toast.error(e?.message || uiT("标记完成失败")),
  });
  if (isLoading) {
    return (
      <Dialog open onClose={onClose} title={uiT("课节详情")} maxWidth="lg">
        <div className="py-12 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          {" " + uiT("加载中…") + " "}
        </div>
      </Dialog>
    );
  }
  if (loadError || !lesson) {
    return (
      <Dialog open onClose={onClose} title={uiT("课节详情")} maxWidth="lg">
        <div className="py-12 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {loadError?.message || uiT("课节信息加载失败")}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => refetch()}>
              {" " + uiT("重试") + " "}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {" " + uiT("关闭") + " "}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }
  const status = lesson.status || "scheduled";
  const endIso = new Date(
    new Date(lesson.scheduled_at).getTime() + Number(lesson.duration_min || 60) * 60_000,
  ).toISOString();
  const statusMeta = STATUS_LABEL()[status] || STATUS_LABEL().scheduled;
  const StatusIcon = statusMeta.icon;
  const isReadOnly = status !== "scheduled";
  const isAdmin = user?.role === "admin";
  const isOwnTeacher = user?.role === "teacher" && lesson.teacher_id === user.id;
  const canModify = isAdmin || isOwnTeacher;
  const canCancel = isAdmin;
  // 反馈详情：老师/管理员可见全部；家长仅可见已发布（草稿不泄露）。
  const canSeeFeedback = user?.role !== "parent" || lesson.published === true;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary-700 dark:text-primary-300 " />
          <span>{uiT("课节详情")}</span>
          <Badge variant={statusMeta.tone} className="ml-1">
            <StatusIcon className="w-3 h-3 mr-1" /> {statusMeta.label}
          </Badge>
        </div>
      }
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* 核心信息 */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label={uiT("学员")}>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {lesson.students?.full_name || "—"}
            </span>
          </Field>
          <Field label={uiT("老师")}>
            <span className="text-gray-700 dark:text-gray-300">
              {lesson.profiles?.full_name || "—"}
            </span>
          </Field>
          <Field label={uiT("时间")}>
            <span className="text-gray-900 dark:text-gray-100">
              {fmtDateTime(lesson.scheduled_at)}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {" " + uiT("至") + " "}
              {fmtTime(endIso)}
            </span>
          </Field>
          <Field label={uiT("时长")}>
            <span className="text-gray-700 dark:text-gray-300">
              {lesson.duration_min || 60}
              {" " + uiT("分钟") + " "}
            </span>
          </Field>
          {lesson.course_id && (
            <Field label={uiT("课程")} className="col-span-2">
              {lesson.course?.name ? (
                <span className="text-gray-800 dark:text-gray-200">{lesson.course.name}</span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {lesson.course_id.slice(0, 8)}…
                </span>
              )}
            </Field>
          )}
          {lesson.meeting_url && (
            <Field label={uiT("上课链接")} className="col-span-2">
              <a
                href={lesson.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-400 hover:underline break-all"
              >
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                {lesson.meeting_url}
              </a>
            </Field>
          )}
        </div>

        {/* 已完成 / 已取消的展示 */}
        {status === "completed" && lesson.completed_at && (
          <div className="rounded-md border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-900/30 px-3 py-2 text-sm">
            <div className="font-medium text-success-700 dark:text-success-300">
              <CheckCircle2 className="w-4 h-4 inline mr-1" />
              {" " + uiT("已完成 ·")} {fmtDateTime(lesson.completed_at)}
            </div>
          </div>
        )}

        {/* 课后反馈（完整分栏；家长仅已发布可见）*/}
        {lesson.record && canSeeFeedback && <FeedbackCard record={lesson.record} />}
        {lesson.history_settled&&<p className="rounded-lg bg-sky-50 p-3 text-sm dark:bg-sky-950">{uiT('历史已结清：本次补录不扣课时，不产生待付课酬。')}</p>}
        {(isAdmin||isOwnTeacher)&&(lesson.record||isAdmin&&status==='no_show')&&status!=='scheduled'&&<Button variant="outline" onClick={()=>setCorrectionOpen(true)}>{uiT(isAdmin&&lesson.absence_review_status==='pending'?'确认缺勤结算':'更正上课记录')}</Button>}
        {correctionOpen&&<LessonCorrectionDialog lesson={lesson} onClose={()=>setCorrectionOpen(false)} onSaved={()=>refetch()}/>}
        {status === "completed" && lesson.record && !canSeeFeedback && (
          <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
            {" " + uiT("老师尚未发布本节课的课后反馈。") + " "}
          </div>
        )}

        {status === "cancelled" && (
          <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
            <X className="w-4 h-4 inline mr-1" />
            {" " + uiT("本节课已被取消,记录保留只读。") + " "}
          </div>
        )}

        {/* 请假信息 */}
        {lesson.leave_status && lesson.leave_status !== "none" && (
          <div className="rounded-md border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/30 px-3 py-2 text-sm">
            <div className="font-medium text-warning-700 dark:text-warning-300">
              {" " + uiT("请假 ·") + " "}
              {LEAVE_LABEL()[lesson.leave_status] || lesson.leave_status}
            </div>
            {lesson.leave_reason && (
              <div className="mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {lesson.leave_reason}
              </div>
            )}
          </div>
        )}

        {lesson.attendance && (
          <div className="rounded-lg bg-warning-50 p-3 text-sm dark:bg-warning-900/30">
            <p>
              {lesson.absence_review_status==='pending'?uiT(user?.role==='parent'?'缺勤已登记，课时扣除待管理员确认。':'缺勤已登记，学生课时及教师课酬待管理员确认。'):lesson.attendance.state === "pending"
                ? uiT("缺席处理结果待确认，请按原选择继续登记。")
                : uiT("缺席处理：{0}", [
                    lesson.attendance.result?.deducted_hours
                      ? uiT("已扣 {0} 小时", [lesson.attendance.result.deducted_hours])
                      : uiT("不扣课时"),
                  ])}
            </p>
            {lesson.attendance.choice?.reason && (
              <p className="mt-1">{lesson.attendance.choice.reason}</p>
            )}
            {canModify && lesson.attendance.state === "pending" && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setAttendanceOpen(true)}
              >
                {" " + uiT("继续缺席登记") + " "}
              </Button>
            )}
          </div>
        )}
        {/* 操作区 */}
        {!isReadOnly && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            {canModify && (
              <Button variant="outline" size="sm" onClick={() => setRescheduleOpen(true)}>
                <Clock className="w-4 h-4 mr-1" />
                {" " + uiT("改时间") + " "}
              </Button>
            )}
            {canModify && (
              <Button size="sm" onClick={() => setFeedbackOpen(true)}>
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {" " + uiT("点名") + " "}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive-600 border-destructive-200 hover:bg-destructive-50 dark:text-destructive-400 dark:border-destructive-800 dark:hover:bg-destructive-900/30"
                onClick={() => setCancelOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                {" " + uiT("取消课节") + " "}
              </Button>
            )}
            {!canModify && !canCancel && (
              <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
                {" " + uiT("你不是本节课的老师,无操作权限。") + " "}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 点名子弹窗 */}
      {attendanceOpen && (
        <AttendanceModal
          lesson={lesson}
          onClose={() => setAttendanceOpen(false)}
          // 到课：先填写反馈并确认扣课，再提交完课。
          onPresent={() => {
            setAttendanceOpen(false);
            setFeedbackOpen(true);
          }}
        />
      )}

      {feedbackOpen && (
        <LessonCompleteModal
          lesson={lesson}
          layer={1}
          onClose={() => !completeMutation.isPending && setFeedbackOpen(false)}
          onSubmit={(payload) => completeMutation.mutate(payload)}
          submitting={completeMutation.isPending}
        />
      )}
      {/* 改期子弹窗 */}
      {rescheduleOpen && (
        <RescheduleDialog
          lesson={lesson}
          onClose={() => setRescheduleOpen(false)}
          layer={1}
          onSaved={() => {
            setRescheduleOpen(false);
            refetch();
            qc.invalidateQueries({
              queryKey: ["schedules"],
            });
            qc.invalidateQueries({
              queryKey: ["lesson-detail", lessonId],
            });
          }}
        />
      )}

      {/* 取消确认 */}
      {cancelOpen && (
        <ConfirmCancelPanel
          onClose={() => setCancelOpen(false)}
          onConfirm={() => cancelMutation.mutate()}
          loading={cancelMutation.isPending}
        />
      )}
    </Dialog>
  );
}
function Field({ label, children, className = "" }) {
  useUiLanguage();
  return (
    <div className={className}>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// 完整课后反馈：学习内容 / 课堂表现 / 课后作业 / 下一步
function FeedbackCard({ record }) {
  useUiLanguage();
  const rows = [
    {
      icon: BookOpen,
      label: uiT("学习内容"),
      value: record.content,
    },
    {
      icon: Award,
      label: uiT("课堂表现"),
      value: record.performance,
    },
    {
      icon: GraduationCap,
      label: uiT("课后作业"),
      value: record.homework,
    },
    {
      icon: Target,
      label: uiT("下一步"),
      value: record.next_plan,
    },
  ].filter((r) => r.value);
  if (!rows.length) {
    return (
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        {" " + uiT("老师未填写文字反馈。") + " "}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-primary-100 dark:border-primary-900/50 overflow-hidden">
      <div className="px-3 py-2 bg-primary-50/70 dark:bg-primary-900/20 text-xs font-medium text-primary-700 dark:text-primary-300">
        {" " + uiT("上课记录") + " "}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2.5 px-3 py-2">
            <r.icon className="w-4 h-4 mt-0.5 text-gray-500 dark:text-gray-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500 dark:text-gray-400">{r.label}</div>
              <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                {r.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ConfirmCancelPanel({ onClose, onConfirm, loading }) {
  useUiLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4 border border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive-100 dark:bg-destructive-900/30 text-destructive-600 dark:text-destructive-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {" " + uiT("确认取消本节课?") + " "}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {" " + uiT("取消后会通知家长,记录将保留只读。无法撤销。") + " "}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {" " + uiT("返回") + " "}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className="bg-destructive-600 hover:bg-destructive-700 text-white"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-1" />
            )}
            {" " + uiT("确认取消") + " "}
          </Button>
        </div>
      </div>
    </div>
  );
}
