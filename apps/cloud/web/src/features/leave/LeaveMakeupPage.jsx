import TeacherAvailabilityPanel from "../schedule/TeacherAvailabilityPanel.jsx";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import ParentMakeupRequestForm from "./ParentMakeupRequestForm.jsx";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../components/ui/segmented.jsx";
import { CalendarX, RotateCcw, CheckCircle2, XCircle, Clock, User } from "lucide-react";
import { useAuth } from "../auth/useAuth.js";
import { Card } from "../../components/ui/card.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { PageShell } from "../../components/PageShell.jsx";
import { schoolInput, inputToIso } from "../schedule/scheduleInsights.js";
import {
  useLeaveRequests,
  useMakeups,
  useCreateLeave,
  useReviewLeave,
  useCreateMakeup,
  usePatchMakeup,
  useMyStudents,
  useUpcomingLessons,
  useTeachers,
} from "./useLeave.js";
const LEAVE_STATUS = () => ({
  pending: {
    label: uiT("待审批"),
    variant: "warning",
  },
  approved: {
    label: uiT("已批准"),
    variant: "success",
  },
  rejected: {
    label: uiT("已驳回"),
    variant: "destructive",
  },
});
const MAKEUP_STATUS = () => ({
  pending: {
    label: uiT("待排期"),
    variant: "warning",
  },
  scheduled: {
    label: uiT("已排期"),
    variant: "default",
  },
  done: {
    label: uiT("已完成"),
    variant: "success",
  },
  cancelled: {
    label: uiT("已取消"),
    variant: "secondary",
  },
});
function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 把 timestamptz 转成 <input type="datetime-local"> 需要的本地字符串
function toLocalInput(dt) {
  return dt ? schoolInput(dt) : "";
}
function Tabs({ value, onChange, role }) {
  useUiLanguage();
  const items = [
    {
      key: "leave",
      label: role === "parent" ? uiT("请假申请") : uiT("请假审批"),
      icon: CalendarX,
    },
    {
      key: "makeup",
      label: uiT("补课单"),
      icon: RotateCcw,
    },
  ];
  return <Segmented value={value} onChange={onChange} items={items} />;
}

// ---------- 请假 ----------

function LeaveRow({ row, canReview, onReview, busy }) {
  useUiLanguage();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const st = LEAVE_STATUS()[row.status] ?? LEAVE_STATUS().pending;
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {row.student_name || uiT("学员")}
            </span>
            <Badge variant={st.variant}>{st.label}</Badge>
            {row.lesson?.scheduled_at && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Clock className="w-3 h-3" />
                {fmt(row.lesson.scheduled_at)}
                {row.lesson.duration_min ? uiT(" · {0} 分钟", [row.lesson.duration_min]) : ""}
              </span>
            )}
          </div>
          {row.reason && (
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {uiT("原因:") + " "}
              {row.reason}
            </div>
          )}
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {row.requester_name ? uiT("{0} 提交", [row.requester_name]) : uiT("提交")}
            {row.reviewed_at
              ? uiT(" · {0} 于 {1} 审批", [row.reviewer_name || uiT("教务"), fmt(row.reviewed_at)])
              : ""}
            {row.review_note ? ` · ${row.review_note}` : ""}
          </div>
        </div>
        {canReview && row.status === "pending" && (
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {" " + uiT("审批") + " "}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <Label htmlFor={`note-${row.id}`}>{uiT("审批备注 (可选)")}</Label>
          <Input
            id={`note-${row.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={uiT("例: 已安排补课时间")}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onReview(row, "approved", note)}
              className="inline-flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {" " + uiT("批准") + " "}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onReview(row, "rejected", note)}
              className="inline-flex items-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" />
              {" " + uiT("驳回") + " "}
            </Button>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {" " + uiT("批准后该课节标记为请假(不扣课时), 并自动生成一张待排期的补课单。") + " "}
          </div>
        </div>
      )}
    </li>
  );
}
function ParentLeaveForm() {
  useUiLanguage();
  const { data: students = [] } = useMyStudents();
  const { data: upcoming = [] } = useUpcomingLessons();
  const create = useCreateLeave();
  const [studentId, setStudentId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(null);
  const [err, setErr] = useState(null);
  const lessons = upcoming.filter((l) => !studentId || l.student_id === studentId);
  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    try {
      await create.mutateAsync({
        student_id: studentId,
        lesson_id: lessonId || null,
        reason: reason.trim() || null,
      });
      setOk(uiT("已提交, 等待教务审批"));
      setReason("");
      setLessonId("");
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="leave-student">{uiT("学员 *")}</Label>
            <Select
              id="leave-student"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setLessonId("");
              }}
            >
              <option value="">{uiT("请选择")}</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave-lesson">{uiT("课程 *")}</Label>
            <Select
              id="leave-lesson"
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
            >
              <option value="">{uiT("请选择需要请假的课程")}</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {fmt(l.scheduled_at)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leave-reason">{uiT("原因")}</Label>
          <Textarea
            id="leave-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={uiT("例: 孩子感冒发烧")}
          />
        </div>
        {err && <div className="text-sm text-danger-600 dark:text-danger-300 ">{err}</div>}
        {ok && <div className="text-sm text-success-600 dark:text-success-300 ">{ok}</div>}
        <Button type="submit" size="sm" disabled={create.isPending || !studentId || !lessonId}>
          {create.isPending ? uiT("提交中…") : uiT("提交请假")}
        </Button>
      </form>
    </Card>
  );
}
function LeavePanel({ role }) {
  useUiLanguage();
  const [status, setStatus] = useState("pending");
  const { data, isLoading, error: loadError, refetch } = useLeaveRequests(status);
  const review = useReviewLeave();
  const [err, setErr] = useState(null);
  const items = data?.items ?? [];
  const canReview = role === "admin" || role === "teacher";
  async function onReview(row, next, note) {
    setErr(null);
    try {
      await review.mutateAsync({
        id: row.id,
        status: next,
        note,
      });
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          items={[
            {
              key: "pending",
              label: uiT("待审批"),
            },
            {
              key: "",
              label: uiT("全部"),
            },
          ]}
          size="sm"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {uiT("共") + " "}
          {items.length}
          {" " + uiT("条")}
        </span>
      </div>

      {role === "parent" && <ParentLeaveForm />}

      {err && <div className="text-sm text-danger-600 dark:text-danger-300 ">{err}</div>}
      {loadError && (
        <p role="alert">
          {" " + uiT("请假申请读取失败。") + " "}
          <Button variant="outline" onClick={() => refetch()}>
            {" " + uiT("重试") + " "}
          </Button>
        </p>
      )}

      {isLoading ? (
        <Loading />
      ) : loadError ? null : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {" " + uiT("没有符合条件的请假申请") + " "}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((row) => (
              <LeaveRow
                key={row.id}
                row={row}
                canReview={canReview}
                busy={review.isPending}
                onReview={onReview}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------- 补课 ----------

function MakeupRow({ row, canEdit, onPatch, busy, teachers }) {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(toLocalInput(row.scheduled_at));
  const [teacherId, setTeacherId] = useState(row.makeup_lesson?.teacher_id || "");
  const st = MAKEUP_STATUS()[row.status] ?? MAKEUP_STATUS().pending;
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {row.student_name || uiT("学员")}
            </span>
            <Badge variant={st.variant}>{st.label}</Badge>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {row.duration_min ?? 60}
              {" " + uiT("分钟") + " "}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {row.scheduled_at ? (
              <>
                {uiT("补课时间:") + " "}
                {fmt(row.scheduled_at)}
              </>
            ) : (
              <>
                {" " + uiT("待排期") + " "}
                {row.original_lesson?.scheduled_at
                  ? uiT(" · 原课 {0}", [fmt(row.original_lesson.scheduled_at)])
                  : ""}
              </>
            )}
            {row.note ? ` · ${row.note}` : ""}
            {row.parent_request && (
              <p className="mt-2 text-primary-700 dark:text-primary-300">
                {" " + uiT("家长补课需求：")}
                {row.parent_request.request_note || uiT("请沟通时间")}
                {row.parent_request.preferred_at
                  ? uiT(" · 希望时间 {0}", [fmt(row.parent_request.preferred_at)])
                  : ""}
              </p>
            )}
          </div>
        </div>
        {canEdit && ["pending", "scheduled"].includes(row.status) && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              {row.status === "pending" ? uiT("排期") : uiT("改期")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                onPatch(row, {
                  status: "cancelled",
                })
              }
            >
              {" " + uiT("取消") + " "}
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`when-${row.id}`}>{uiT("补课时间 *")}</Label>
              <Input
                id={`when-${row.id}`}
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`teacher-${row.id}`}>{uiT("补课老师 *")}</Label>
              <Select
                id={`teacher-${row.id}`}
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                <option value="">{uiT("请选择")}</option>
                {teachers.map((t) => (
                  <option key={t.id || t.profile_id} value={t.profile_id || t.id}>
                    {t.full_name || t.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <details className="my-3">
            <summary className="cursor-pointer text-primary-700 dark:text-primary-300">
              {uiT("查看教师空闲时间安排补课")}
            </summary>
            <TeacherAvailabilityPanel
              anchor={when ? new Date(when + ":00+08:00") : new Date()}
              onSelect={(slot) => {
                setTeacherId(slot.teacher_id);
                setWhen(slot.scheduled_at);
              }}
            />
          </details>
          <Button
            size="sm"
            disabled={busy || !inputToIso(when) || !teacherId}
            onClick={() =>
              onPatch(row, {
                status: "scheduled",
                scheduled_at: inputToIso(when),
                teacher_id: teacherId,
              })
            }
          >
            {" " + uiT("确认排期") + " "}
          </Button>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {" " +
              uiT(
                "排期会生成正式课；改期会同步更新课表。补课完课后自动关闭补课单，按课程规则扣课时及计课酬。",
              ) +
              " "}
          </div>
        </div>
      )}
    </li>
  );
}
function MakeupPanel({ role }) {
  useUiLanguage();
  const { user } = useAuth();
  const [status, setStatus] = useState("pending");
  const { data, isLoading, error: loadError, refetch } = useMakeups(status);
  const patch = usePatchMakeup();
  const { data: teachers = [] } = useTeachers(role !== "parent");
  const [err, setErr] = useState(null);
  const items = data?.items ?? [];
  const canEdit = role === "admin" || role === "teacher";
  async function onPatch(row, body) {
    setErr(null);
    try {
      await patch.mutateAsync({
        id: row.id,
        ...body,
      });
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="space-y-3">
      {role === "parent" && <ParentMakeupRequestForm />}
      <div className="flex items-center justify-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          items={[
            {
              key: "pending",
              label: uiT("待排期"),
            },
            {
              key: "",
              label: uiT("全部"),
            },
          ]}
          size="sm"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {uiT("共") + " "}
          {items.length}
          {" " + uiT("条")}
        </span>
      </div>

      {err && <div className="text-sm text-danger-600 dark:text-danger-300 ">{err}</div>}
      {loadError && (
        <p role="alert">
          {" " + uiT("补课单读取失败。") + " "}
          <Button variant="outline" onClick={() => refetch()}>
            {" " + uiT("重试") + " "}
          </Button>
        </p>
      )}

      {isLoading ? (
        <Loading />
      ) : loadError ? null : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {" " + uiT("没有符合条件的补课单") + " "}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((row) => (
              <MakeupRow
                key={row.id}
                row={row}
                canEdit={
                  canEdit &&
                  (role === "admin" ||
                    row.original_lesson?.teacher_id === user?.id ||
                    row.makeup_lesson?.teacher_id === user?.id)
                }
                busy={patch.isPending}
                teachers={teachers.filter(
                  (t) => t.active !== false && (role !== "teacher" || t.profile_id === user?.id),
                )}
                onPatch={onPatch}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
export default function LeaveMakeupPage() {
  useUiLanguage();
  const { user } = useAuth();
  const role = user?.role || "parent";
  // ⚠️ tab 原本纯 useState("leave")，而侧边栏有两个入口都渲染本页：
  //   「请假 / 补课」→ /leave              「补课管理」→ /admin/leave/makeup
  // 点「补课管理」进来看到的却是请假 tab（同一页面、两个入口、结果与标签不符）。
  // 现在从 URL 读初始 tab，并把切换写回 URL：刷新不丢、两个入口各归各位。
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") === "makeup" ? "makeup" : "leave";
  const [tab, setTabRaw] = useState(urlTab);

  // URL 变了（用户点了另一个入口）就跟着换，本地state 只在没有 URL 线索时兜底
  useEffect(() => {
    setTabRaw(urlTab);
  }, [urlTab]);
  function setTab(v) {
    setTabRaw(v);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === "leave") next.delete("tab");
        else next.set("tab", v);
        return next;
      },
      {
        replace: true,
      },
    );
  }
  const home = role === "teacher" ? "/teacher/today" : role === "parent" ? "/parent" : "/admin";
  return (
    <PageShell
      back={home}
      backLabel={role === "teacher" ? uiT("今日") : role === "parent" ? uiT("首页") : uiT("总览")}
      icon={CalendarX}
      title={uiT("请假 / 补课")}
      subtitle={
        role === "parent" ? uiT("请假申请 · 补课安排") : uiT("审批请假，批准后生成补课单并排期")
      }
      contentClassName="space-y-4"
    >
      <Tabs value={tab} onChange={setTab} role={role} />
      {tab === "leave" ? <LeavePanel role={role} /> : <MakeupPanel role={role} />}
    </PageShell>
  );
}
