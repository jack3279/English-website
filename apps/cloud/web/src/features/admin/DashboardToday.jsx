import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, ChevronRight } from "lucide-react";
import { http } from "../../lib/http.js";
import { schoolDay } from "../schedule/scheduleInsights.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
const states = { scheduled: "待上课", completed: "已完成", cancelled: "已取消", no_show: "缺席" };
export default function DashboardToday({ showMetrics = true, previewLimit }) {
  const day = schoolDay(new Date()),
    from = new Date(`${day}T00:00:00+08:00`).toISOString(),
    to = new Date(`${day}T23:59:59.999+08:00`).toISOString();
  const query = useQuery({
    queryKey: ["dashboard", "today", day],
    queryFn: async () => (await http(`/schedules?${new URLSearchParams({ from, to })}`)).data,
    refetchInterval: 60000,
  });
  const lessons = Array.isArray(query.data) ? query.data : [],
    active = lessons.filter((l) => l.status !== "cancelled");
  const hours = active
    .filter((l) => l.status !== "no_show")
    .reduce((sum, l) => sum + Number(l.duration_min || 0) / 60, 0);
  return (
    <section className="space-y-4">
      {showMetrics && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: active.length, label: "今日课次" },
            { value: Number(hours.toFixed(2)), label: "今日排课（小时）" },
            { value: active.filter((l) => l.status === "scheduled").length, label: "待点名" },
          ].map((m) => (
            <Card key={m.label} className="p-4">
              <div className="mb-3 text-primary-700 dark:text-primary-300 ">
                <CalendarDays className="h-5 w-5" />
              </div>
              <strong className="text-3xl tabular-nums">
                {query.isLoading ? "…" : query.isError ? "—" : m.value}
              </strong>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 ">{m.label}</p>
            </Card>
          ))}
        </div>
      )}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4 text-primary-700 dark:text-primary-300 " />
            今日课程
          </h2>
          <Link to="/schedule" className="text-xs text-primary-700 dark:text-primary-300 ">
            查看全部 →
          </Link>
        </div>
        {!query.isLoading && !query.isError && (
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400 ">
            今日已排 {Number(hours.toFixed(2))} 小时 · {active.length} 节
            {previewLimit && lessons.length > previewLimit
              ? ` · 下方显示前 ${previewLimit} 节`
              : ""}
          </p>
        )}
        {query.isLoading ? (
          <p className="py-10 text-center text-gray-500 dark:text-gray-400 ">正在读取课程…</p>
        ) : query.isError ? (
          <div role="alert">
            课程加载失败{" "}
            <Button variant="outline" onClick={() => query.refetch()}>
              重试
            </Button>
          </div>
        ) : !lessons.length ? (
          <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400 ">
            今天没有安排课程
          </p>
        ) : (
          <div className="space-y-3">
            {(previewLimit ? lessons.slice(0, previewLimit) : lessons).map((l) => (
              <Link
                key={l.id}
                to="/schedule"
                className={`desktop-lesson-row ${l.status === "cancelled" ? "opacity-60" : ""}`}
              >
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{l.students?.full_name || "未填写学员"}</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
                    {new Date(l.scheduled_at).toLocaleTimeString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {l.profiles?.full_name || "未填写教师"} · {l.duration_min} 分钟
                  </p>
                </div>
                <Badge
                  variant={
                    l.status === "completed"
                      ? "success"
                      : l.status === "no_show"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {states[l.status] || l.status}
                </Badge>
                <ChevronRight className="h-3 w-3 text-gray-500 dark:text-gray-400 " />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
