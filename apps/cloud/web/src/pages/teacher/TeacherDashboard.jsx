import { Calendar, CheckCircle, Clock } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { StatCard } from "../../components/StatCard.jsx";
import { Card } from "../../components/Card.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { useTeacherSchedule } from "../../features/dashboard/useTeacherSchedule.js";

export default function TeacherDashboard() {
  const { data: lessons = [], isLoading } = useTeacherSchedule();
  const completed = lessons.filter((l) => l.status === "completed").length;
  return (
    <>
      <PageHeader title="今日" description="你今天的工作" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard title="今日总课" value={lessons.length} icon={Calendar} />
        <StatCard title="已完成" value={completed} icon={CheckCircle} tone="success" />
        <StatCard title="待上" value={lessons.length - completed} icon={Clock} />
      </div>
      <Card>
        <h3 className="text-base font-semibold mb-3">课表</h3>
        {isLoading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : lessons.length === 0 ? (
          <EmptyState title="今天没课" icon={Calendar} />
        ) : (
          <ul className="space-y-2">
            {lessons.map((l) => (
              <li key={l.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm">
                  {new Date(l.scheduled_at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-sm font-medium">{l.students?.full_name}</span>
                <span className="text-sm text-gray-500 ml-auto">
                  {l.status === "completed" ? "✓ 已完成" : "待上"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
