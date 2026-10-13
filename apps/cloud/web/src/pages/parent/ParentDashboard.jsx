import { Calendar, CheckCircle } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/Card.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { useParentFeed } from "../../features/dashboard/useParentFeed.js";

export default function ParentDashboard() {
  const { data: feeds = [], isLoading } = useParentFeed(5);
  return (
    <>
      <PageHeader title="孩子课表" description="最近的课和老师反馈" />
      <Card>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> 最近反馈
        </h3>
        {isLoading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : feeds.length === 0 ? (
          <EmptyState title="还没有反馈" icon={Calendar} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {feeds.map((f) => (
              <li key={f.id} className="py-3">
                <div className="text-xs text-gray-500">
                  {f.student_name} · {new Date(f.published_at).toLocaleString("zh-CN")}
                </div>
                <div className="text-sm text-gray-800 mt-1">{f.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
