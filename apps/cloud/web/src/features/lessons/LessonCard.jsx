import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { safeMeetingUrl } from "../../lib/lessonDisplay.js";
import { CheckCircle2, Clock } from "lucide-react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
const STATES = () => ({
  scheduled: {
    label: uiT("待上课"),
    tone: "default",
  },
  completed: {
    label: uiT("已完成"),
    tone: "success",
  },
  cancelled: {
    label: uiT("已取消"),
    tone: "secondary",
  },
  no_show: {
    label: uiT("缺席"),
    tone: "destructive",
  },
});
export default function LessonCard({ lesson, onAttendance }) {
  useUiLanguage();
  const start = new Date(lesson.scheduled_at),
    end = new Date(start.getTime() + Number(lesson.duration_min || 0) * 60000);
  const fmt = (d) =>
    d.toLocaleTimeString(uiLocale(), {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
    });
  const live = lesson.status === "scheduled" && start <= new Date() && end > new Date();
  const meeting = safeMeetingUrl(lesson.courses?.meeting_url);
  const state = STATES()[lesson.status] || STATES().scheduled,
    pending = lesson.leave_status === "pending";
  return (
    <article
      className={`lesson-design-card ${live ? "is-live" : ""} ${lesson.status === "cancelled" ? "is-cancelled" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">
          {lesson.students?.full_name || uiT("未填写学员姓名")}
          {lesson.courses?.name && <span className="ml-1">· {lesson.courses.name}</span>}
        </h3>
        <Badge variant={live ? "default" : state.tone}>{live ? uiT("进行中") : state.label}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400 ">
        <Clock className="h-3.5 w-3.5" />
        <span>
          {fmt(start)}–{fmt(end)}
        </span>
        <span>
          · {lesson.duration_min || 0}
          {" " + uiT("分钟")}
        </span>
        {lesson.profiles?.full_name && <span>· {lesson.profiles.full_name}</span>}
      </div>
      {meeting && lesson.status === "scheduled" && (
        <a
          className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary-50 px-3 text-sm font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-200"
          href={meeting}
          rel="noopener noreferrer"
          target="_blank"
        >
          {" " + uiT("进入教室") + " "}
        </a>
      )}
      {pending ? (
        <p className="mt-3 text-sm text-warning-700 dark:text-warning-300 ">
          {" " + uiT("请假待确认，请先处理请假申请。") + " "}
        </p>
      ) : (
        lesson.status === "scheduled" && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => onAttendance(lesson)}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {" " + uiT("课程点名") + " "}
            </Button>
          </div>
        )
      )}
    </article>
  );
}
