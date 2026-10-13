import { Video, ChevronRight } from "lucide-react";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { safeMeetingUrl, lessonTimeRange, validLessonDate } from "../../lib/lessonDisplay.js";
export default function ParentLessonCard({ lesson, onLeave }) {
  const date = validLessonDate(lesson.scheduled_at),
    url = safeMeetingUrl(lesson.courses?.meeting_url),
    pending = lesson.leave_status === "pending",
    approved = lesson.leave_status === "approved";
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-primary-50 py-2 text-primary-700 dark:bg-primary-950 dark:text-primary-300 ">
          {date ? (
            <>
              <strong className="text-xl">
                {date
                  .toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" })
                  .replace("日", "")}
              </strong>
              <span className="text-[10px]">
                {date.toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  weekday: "short",
                })}
              </span>
            </>
          ) : (
            <span className="text-xs">待定</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{lesson.courses?.name || "上课安排"}</h3>
            <Badge variant={pending ? "warning" : approved ? "success" : "secondary"}>
              {pending ? "请假待确认" : approved ? "已请假" : "待上课"}
            </Badge>
          </div>
          <p className="mt-2 text-base font-semibold tabular-nums">{lessonTimeRange(lesson)}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
            {date
              ? `${date.toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  month: "numeric",
                  day: "numeric",
                })} · `
              : ""}
            {lesson.profiles?.full_name || "外教老师"} · {lesson.duration_min} 分钟
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        {url && !approved && (
          <a
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Video className="h-4 w-4" />
            进入教室
          </a>
        )}
        {!pending && !approved && (
          <Button variant="outline" onClick={() => onLeave(lesson)} className="min-h-10 flex-1">
            {lesson.leave_status === "rejected" ? "重新请假" : "请假"}
            <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </Card>
  );
}
