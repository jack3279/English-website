import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, Users, AlertTriangle, ListChecks } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { schoolDay } from "../schedule/scheduleInsights.js";
export default function DesktopOverview({ ops }) {
  const summary = useQuery({
    queryKey: ["dashboard", "month-summary", schoolDay(new Date()).slice(0, 7)],
    queryFn: async () => (await http("/finance/summary")).data,
    staleTime: 60000,
  });
  const alerts = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    staleTime: 60000,
  });
  const number = (query, value) => (query.isLoading ? "…" : query.isError ? "—" : (value ?? "—"));
  const items = [
    {
      label: "本月累计消课",
      value: number(summary, summary.data?.this_month?.consumed_hours),
      unit: "小时",
      icon: Clock,
      to: "/admin/finance",
    },
    {
      label: "在读学员",
      value: number(summary, summary.data?.total?.active_students),
      unit: "人",
      icon: Users,
      to: "/students",
    },
    {
      label: "课时预警",
      value: number(
        alerts,
        alerts.data
          ? (alerts.data.low_balance?.length || 0) + (alerts.data.zero_balance?.length || 0)
          : null,
      ),
      unit: "人",
      icon: AlertTriangle,
      to: "/admin/alerts",
    },
    {
      label: "待处理事项",
      value: ops?.summary?.total ?? "—",
      unit: "项",
      icon: ListChecks,
      to: "/admin/operations",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.map(({ icon: Icon, ...item }) => (
        <Link key={item.label} to={item.to}>
          <Card className="h-full p-5 transition hover:ring-primary-300">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400 ">{item.label}</p>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300 ">
                <Icon className="h-5 w-5" />
              </span>
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {item.value}
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400 ">
                {item.unit}
              </span>
            </div>
            <p className="mt-3 text-xs text-primary-700 dark:text-primary-300">查看明细 ›</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
