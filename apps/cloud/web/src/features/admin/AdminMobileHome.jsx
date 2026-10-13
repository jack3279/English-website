import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Users,
  Sparkles,
  Wallet,
  GraduationCap,
  Receipt,
  Megaphone,
  Grid2X2,
  ChevronRight,
} from "lucide-react";
import { http } from "../../lib/http.js";
import { useMobile } from "../../lib/useMobile.js";
import { schoolDay } from "../schedule/scheduleInsights.js";
import { useInstitution } from "./InstitutionContext.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import DashboardToday from "./DashboardToday.jsx";
const shortcuts = [
  { to: "/schedule", label: "排课", icon: CalendarDays },
  { to: "/students", label: "学员", icon: Users },
  { to: "/admin/leads", label: "招生", icon: Sparkles },
  { to: "/admin/finance", label: "财务", icon: Wallet },
  { to: "/admin/teachers", label: "教师", icon: GraduationCap },
  { to: "/admin/payroll", label: "课酬", icon: Receipt },
  { to: "/admin/notifications", label: "发通知", icon: Megaphone },
  { to: "/admin/features", label: "全部", icon: Grid2X2 },
];
function value(query, number) {
  return query.isPending ? "…" : query.isError ? "—" : (number ?? "—");
}
export default function AdminMobileHome({ ops, me, opsLoading, opsError, retryOps }) {
  const enabled = useMobile(),
    { rules } = useInstitution(),
    day = schoolDay(new Date());
  const summary = useQuery({
    queryKey: ["admin-mobile", "finance-summary"],
    queryFn: async () => (await http("/finance/summary")).data,
    enabled,
    staleTime: 60000,
  });
  const alerts = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    enabled,
    staleTime: 60000,
  });
  const today = useQuery({
    queryKey: ["dashboard", "today", day],
    queryFn: async () =>
      (
        await http(
          `/schedules?${new URLSearchParams({ from: new Date(`${day}T00:00:00+08:00`).toISOString(), to: new Date(`${day}T23:59:59.999+08:00`).toISOString() })}`,
        )
      ).data,
    enabled,
    staleTime: 60000,
  });
  const count = (alerts.data?.zero_balance?.length || 0) + (alerts.data?.low_balance?.length || 0);
  const total = ops?.summary?.total ?? 0,
    groups = (ops?.groups || []).filter((g) => g.count > 0),
    lessons = Array.isArray(today.data) ? today.data : [];
  const revenue = summary.data?.this_month?.revenue_cents;
  const cards = [
    {
      label: "在读学员",
      value: value(summary, summary.data?.total?.active_students),
      to: "/students",
    },
    { label: "课时预警", value: value(alerts, count), to: "/admin/alerts", tone: "danger" },
    {
      label: "今日课次",
      value: value(today, lessons.filter((l) => l.status !== "cancelled").length),
      to: "/schedule",
    },
    {
      label: "本月收入 ¥",
      value: value(
        summary,
        revenue == null
          ? null
          : (Number(revenue) / 100).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              maximumFractionDigits: 2,
              notation: "compact",
            }),
      ),
      to: "/admin/finance",
    },
  ];
  return (
    <main className="admin-mobile-home page-body space-y-5 md:hidden">
      <section className="home-intro">
        <h2 className="text-lg font-semibold">{me?.full_name || "管理员"}，你好</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
          {new Date().toLocaleDateString("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}{" "}
          · 当前课时预警线 {rules.lowBalanceHours} 小时
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {cards.map((card) => (
            <Link key={card.label} to={card.to} className={`admin-mobile-stat ${card.tone || ""}`}>
              <strong>{card.value}</strong>
              <span>{card.label}</span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">今日待办</h2>
          <Link
            className="text-xs font-medium text-primary-700 dark:text-primary-300 "
            to="/admin/operations"
          >
            {opsLoading ? "读取中…" : opsError ? "查看待办" : `全部 ${total} 项`}
          </Link>
        </div>
        {opsLoading ? (
          <Card className="p-5 text-sm text-gray-500 dark:text-gray-400 ">正在读取待办…</Card>
        ) : opsError ? (
          <Card className="p-5">
            <p role="alert">待办加载失败，暂时无法确认是否有待处理事项。</p>
            <Button variant="outline" className="mt-3" onClick={retryOps}>
              重试
            </Button>
          </Card>
        ) : !groups.length ? (
          <Card className="p-6 text-center text-sm text-gray-500 dark:text-gray-400 ">
            暂无待处理事项
          </Card>
        ) : (
          <div className="space-y-3">
            {groups.slice(0, 4).map((group) => (
              <Link
                key={group.key || group.kind || group.title}
                to={group.link || "/admin/operations"}
                className={`admin-mobile-todo ${group.severity || "info"}`}
              >
                <span className="todo-stripe" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
                    {group.description || `共 ${group.count} 项需要跟进`}
                  </p>
                </div>
                <strong className="todo-count">{group.count}</strong>
                <ChevronRight className="h-3 w-3 text-gray-500 dark:text-gray-400 " />
              </Link>
            ))}
          </div>
        )}
      </section>
      {enabled && <DashboardToday showMetrics={false} previewLimit={3} />}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">快捷操作</h2>
          <Link
            className="text-xs font-medium text-primary-700 dark:text-primary-300 "
            to="/admin/features"
          >
            全部功能
          </Link>
        </div>
        <Card className="grid grid-cols-4 gap-x-2 gap-y-5 p-4">
          {shortcuts.map(({ to, label, icon: Icon }) => (
            <Link className="flex flex-col items-center gap-2 text-xs" key={to} to={to}>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300 ">
                <Icon className="h-5 w-5" />
              </span>
              {label}
            </Link>
          ))}
        </Card>
      </section>
    </main>
  );
}
