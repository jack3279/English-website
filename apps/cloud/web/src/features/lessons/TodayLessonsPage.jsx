import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Link, useNavigate } from "react-router-dom";
import { useMobile } from "../../lib/useMobile.js";
import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";
import { schoolDay } from "../schedule/scheduleInsights.js";
import { useState, useMemo } from "react";
import { Calendar, CheckCircle2, Sparkles } from "lucide-react";
import { useSchedule } from "../schedule/useSchedule.js";
import LessonCard from "./LessonCard.jsx";
import LessonCompleteModal from "./LessonCompleteModal.jsx";
import AttendanceModal from "./AttendanceModal.jsx";
import { useCompleteLesson } from "./useCompleteLesson.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
export default function TodayLessonsPage() {
  useUiLanguage();
  const mobile = useMobile(),
    navigate = useNavigate();
  const today = useMemo(
    () =>
      new Date().toLocaleDateString(uiLocale(), {
        timeZone: "Asia/Shanghai",
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [uiLocale()],
  );
  const { from, to } = useMemo(
    () => ({
      from: new Date(`${schoolDay(new Date())}T00:00:00+08:00`).toISOString(),
      to: new Date(`${schoolDay(new Date())}T23:59:59.999+08:00`).toISOString(),
    }),
    [uiLocale()],
  );
  const {
    data: lessons = [],
    isLoading,
    error,
  } = useSchedule({
    from,
    to,
  });
  const { user } = useAuth();
  const payroll = useQuery({
    queryKey: ["teacher-home-payroll"],
    enabled: user?.role === "teacher",
    queryFn: async () =>
      (
        await http(
          `/finance/payroll/report?from=${schoolDay(new Date()).slice(0, 7)}-01&to=${schoolDay(new Date())}`,
        )
      ).data,
    staleTime: 60000,
  });
  const pending = useQuery({
    queryKey: ["teacher", "operations"],
    queryFn: async () => (await http("/operations")).data,
    enabled: user?.role === "teacher",
    staleTime: 60000,
    refetchInterval: 60000,
  });
  const reportCount = (pending.data?.groups || [])
    .filter((g) => ["missing_feedback", "overdue_lesson"].includes(g.key))
    .reduce((n, g) => n + Number(g.count || 0), 0);
  const complete = useCompleteLesson();
  const [target, setTarget] = useState(null);
  const [attendanceTarget, setAttendanceTarget] = useState(null);
  const completed = lessons.filter((l) => l.status === "completed").length;
  const remaining = lessons.filter((l) => l.status === "scheduled").length;
  const nextLesson = [...lessons]
    .filter(
      (l) =>
        l.status === "scheduled" &&
        Date.parse(l.scheduled_at) + Number(l.duration_min || 60) * 60000 > Date.now(),
    )
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0];
  const hours = lessons
    .filter((l) => l.status !== "cancelled" && l.status !== "no_show")
    .reduce((sum, l) => sum + Number(l.duration_min || 0) / 60, 0);
  async function onSubmit(payload) {
    try {
      await complete.mutateAsync({
        lessonId: target.id,
        studentId: target.student_id,
        payload,
      });
      setTarget(null);
    } catch {
      // 错误提示已由 useCompleteLesson 的 onError 统一弹 toast。
      // 曾在这里用 alert 兜错 —— 阻塞式、且与项目的 toast 体系不一致。
      // 保留弹窗不关：让用户看到哪些字段还没填、能直接改完重试。
    }
  }
  return (
    <div className="min-h-full">
      <PageHeader
        back={false}
        icon={Calendar}
        title={
          user?.role === "teacher"
            ? uiT("{0}的工作台", [user.full_name || uiT("老师")])
            : uiT("今日课程")
        }
        subtitle={uiT("{0} · {1} 节 · 已完成 {2} · 待完成 {3}", [
          today,
          lessons.length,
          completed,
          remaining,
        ])}
      />

      <main className="page-body space-y-4">
        {!isLoading && !error && (
          <section className="home-intro">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs">
                  {nextLesson
                    ? Date.parse(nextLesson.scheduled_at) <= Date.now()
                      ? uiT("当前课节")
                      : uiT("下一节课程")
                    : uiT("今日教学安排")}
                </p>
                <h2 className="mt-1">
                  {nextLesson?.students?.full_name ||
                    (remaining ? uiT("{0} 节课程待登记", [remaining]) : uiT("查看课程与教学待办"))}
                </h2>
                <p className="mt-2 text-sm">
                  {nextLesson
                    ? uiT("{0} · {1} 分钟", [
                        new Date(nextLesson.scheduled_at).toLocaleTimeString(uiLocale(), {
                          timeZone: "Asia/Shanghai",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }),
                        nextLesson.duration_min || 60,
                      ])
                    : uiT("课后点名并填写本节课内容，方便家长查询上课记录")}
                </p>
              </div>
              <Link
                to="/schedule"
                className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-100"
              >
                {" " + uiT("查看课表 ›") + " "}
              </Link>
            </div>
          </section>
        )}
        {!isLoading && !error && (
          <>
            <div className="teacher-summary">
              <div className="teacher-metric">
                <strong>{Number(hours.toFixed(2))}</strong>
                <span>{uiT("今日排课（小时）")}</span>
              </div>
              <Link to="/teacher/operations" className="teacher-metric orange">
                <strong>{pending.isPending ? "…" : pending.isError ? "—" : reportCount}</strong>
                <span>{uiT("待确认／待发送")}</span>
              </Link>
              <Link to="/teacher/payroll" className="teacher-metric teal">
                <strong>
                  {payroll.isLoading
                    ? "…"
                    : payroll.error
                      ? "—"
                      : user?.role === "teacher"
                        ? Object.entries(payroll.data?.totals?.by_currency || {})
                            .map(([code, amount]) => `${Number(amount).toFixed(2)} ${code}`)
                            .join(" · ") || "0"
                        : uiT("查看")}
                </strong>
                <span>{uiT("本月应计课酬")}</span>
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{uiT("今日课单")}</h2>
              <Link
                className="text-sm font-semibold text-primary-700 dark:text-primary-300 "
                to="/schedule"
              >
                {" " + uiT("全部课表") + " "}
              </Link>
            </div>
          </>
        )}
        {user?.role === "teacher" && (
          <Link className="mobile-shortcut" to="/teacher/operations">
            {" " + uiT("教学待办与补课安排") + " "}
            <span className="ml-auto text-primary-700 dark:text-primary-300 ">{uiT("查看 ›")}</span>
          </Link>
        )}
        {isLoading && <LoadingCard />}
        {error && (
          <Card className="p-4 bg-danger-50 border-danger-200 text-danger-700 text-sm dark:bg-danger-900/25 dark:border-danger-800 dark:text-danger-300 ">
            {" " + uiT("加载失败:") + " "}
            {error.message}
          </Card>
        )}

        {/* 空态必须排除 error：出错时 lessons 为空数组，
            否则「加载失败」和「今天没有课」会同时显示，用户以为真没课。 */}
        {!isLoading && !error && lessons.length === 0 && (
          <Card className="p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
              <Sparkles className="w-7 h-7 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="text-base font-medium text-gray-700 dark:text-gray-300">
              {uiT("今天没有课")}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1">
              {" " + uiT("可以查看完整课表或处理教学待办") + " "}
            </div>
          </Card>
        )}

        {!isLoading &&
          !error &&
          completed > 0 &&
          lessons.every((l) => l.status === "completed" || l.status === "cancelled") && (
            <Card className="p-4 bg-success-50 border-success-200 inline-flex items-center gap-2 w-full dark:bg-success-900/25 dark:border-success-800 ">
              <CheckCircle2 className="w-5 h-5 text-success-600 dark:text-success-300 " />
              <span className="text-sm font-medium text-success-700 dark:text-success-300 ">
                {" " + uiT("今天的课全部完成 🎉") + " "}
              </span>
            </Card>
          )}

        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {uiT("上课时间按北京时间（UTC+8）显示")}
        </p>
        <div className="grid gap-3 xl:grid-cols-2">
          {lessons.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              onAttendance={(l) => (mobile ? navigate(`/teacher/feedback/${l.id}`) : setAttendanceTarget(l))}
            />
          ))}
        </div>
      </main>

      {attendanceTarget && (
        <AttendanceModal
          lesson={attendanceTarget}
          onClose={() => setAttendanceTarget(null)}
          // 到课：关点名框，打开完课弹窗（填反馈、扣课时）
          onPresent={(l) => {
            setAttendanceTarget(null);
            if (mobile) navigate(`/teacher/feedback/${l.id}`);
            else setTarget(l);
          }}
        />
      )}

      {target && (
        <LessonCompleteModal
          lesson={target}
          onClose={() => setTarget(null)}
          onSubmit={onSubmit}
          submitting={complete.isPending}
        />
      )}
    </div>
  );
}
