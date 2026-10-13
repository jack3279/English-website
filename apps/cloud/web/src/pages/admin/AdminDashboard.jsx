import { Calendar, CheckCircle, Users, AlertTriangle } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { StatCard } from "../../components/StatCard.jsx";
import { Card } from "../../components/Card.jsx";
import { useDashboardStats } from "../../features/dashboard/useDashboardStats.js";

export default function AdminDashboard() {
  const { data, isLoading } = useDashboardStats();
  return (
    <>
      <PageHeader title="总览" description="机构运营数据一屏看清" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="今日课数"
          value={isLoading ? "-" : (data?.todayLessons ?? 0)}
          icon={Calendar}
        />
        <StatCard
          title="今日已完成"
          value={isLoading ? "-" : (data?.todayCompleted ?? 0)}
          icon={CheckCircle}
          tone="success"
        />
        <StatCard
          title="活跃学员"
          value={isLoading ? "-" : (data?.activeStudents ?? 0)}
          icon={Users}
        />
        <StatCard
          title="低余额(<3h)"
          value={isLoading ? "-" : (data?.lowBalance ?? 0)}
          icon={AlertTriangle}
          tone={(data?.lowBalance ?? 0) > 0 ? "danger" : "primary"}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <h3 className="text-base font-semibold mb-3">低余额学员 (待跟进)</h3>
          <p className="text-sm text-gray-500">从学员管理页面筛选 remaining_hours &lt; 3</p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold mb-3">待跟进 Lead</h3>
          <p className="text-sm text-gray-500">从招生 / 试听 页面跟进</p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold mb-3">今日试听</h3>
          <p className="text-sm text-gray-500">今日预约的试课</p>
        </Card>
      </div>
    </>
  );
}
