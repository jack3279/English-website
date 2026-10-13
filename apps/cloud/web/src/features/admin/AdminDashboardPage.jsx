import DesktopOverview from "./DesktopOverview.jsx";
import AdminMobileHome from "./AdminMobileHome.jsx";
import DashboardToday from "./DashboardToday.jsx";
import { Link } from "react-router-dom";
import { lazy, Suspense, useState } from "react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { Loading } from "../../components/ui/loading.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
const DashboardCharts = lazy(() => import("./DashboardCharts.jsx"));
import {
  LayoutDashboard,
  AlertTriangle,
  ChevronRight,
  CheckCircle,
  ListChecks,
  TrendingUp,
  ChevronDown,
} from "lucide-react";

export function LowBalanceWidget() {
  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    refetchInterval: 60000,
  });
  const data = [...(report?.zero_balance ?? []), ...(report?.low_balance ?? [])];

  if (isLoading) return <Loading />;
  if (isError)
    return (
      <div role="alert" className="rounded-2xl bg-white p-4 text-sm dark:bg-gray-900">
        课时预警加载失败，暂时无法确认学员余额。
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-2 text-primary-700 underline dark:text-primary-300 "
        >
          重试
        </button>
      </div>
    );
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-gray-900/[0.04] dark:bg-gray-900 dark:ring-white/[0.06]">
        <CheckCircle className="w-5 h-5 text-success-500" />
        <div className="text-sm text-gray-600 dark:text-gray-400">所有学员课时充足</div>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-2xl bg-white p-3 shadow-card ring-1 ring-warning-200/80 dark:bg-gray-900">
      {data.slice(0, 5).map((s) => (
        <Link
          key={s.id}
          to={`/students/${s.id}`}
          className="flex items-center justify-between px-3 py-2 rounded hover:bg-warning-50/50 transition"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning-500" />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {s.full_name}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400">
              剩余
            </span>
            <span
              className={`text-sm font-bold ${(s.remaining_hours ?? 0) === 0 ? "text-danger-600 dark:text-danger-300 " : "text-warning-600 dark:text-warning-300 "}`}
            >
              {s.remaining_hours ?? 0}h
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
          </div>
        </Link>
      ))}
      {data.length > 5 && (
        <div className="text-center text-xs text-gray-500 dark:text-gray-400 pt-1">
          还有 {data.length - 5} 名学员…
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await http("/me")).data,
  });

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await http("/branches")).data,
  });

  // 运营待办数 —— 让管理员一进工作台就知道今天有没有活, 不用挨个点开各个页面
  const {
    data: ops,
    isLoading: opsLoading,
    isError: opsError,
    refetch: retryOps,
  } = useQuery({
    queryKey: ["operations", "todo", "badge"],
    queryFn: async () => (await http("/operations")).data,
    refetchInterval: 120000,
  });
  const todoCount = ops?.summary?.total ?? 0;

  const branch = (branches ?? []).find((b) => b.id === me?.branch_id);

  return (
    <div className="min-h-full admin-mobile-page">
      {/* 原来这里有一条自带品牌 + 头像 + 登出的自定义顶栏, 现在品牌归侧边栏、
          铃铛/用户菜单归 PageHeader, 避免同一个页面出现两套品牌标识。 */}
      <PageHeader
        back={false}
        icon={LayoutDashboard}
        title="工作台"
        subtitle={branch?.name || "全部校区"}
      />

      <AdminMobileHome
        ops={ops}
        me={me}
        opsLoading={opsLoading}
        opsError={opsError}
        retryOps={retryOps}
      />
      <main className="page-body space-y-5 hidden md:block">
        <section className="home-intro flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2>{me?.full_name || "管理员"}，你好</h2>
            <p className="mt-1 text-sm">
              {new Date().toLocaleDateString("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "long",
                day: "numeric",
                weekday: "long",
              })}{" "}
              · 先处理教务待办，再查看今日课程
            </p>
          </div>
          <Link
            to="/schedule"
            className="rounded-xl bg-primary-700 px-5 py-3 text-sm font-semibold text-white hover:bg-primary-800"
          >
            查看课程表
          </Link>
        </section>
        <DesktopOverview ops={ops} />
        <div className="desktop-dashboard-grid mt-5">
          <DashboardToday showMetrics={false} previewLimit={8} />
          <aside className="min-w-0 space-y-5">
            <Card
              role={opsError ? "alert" : undefined}
              className="flex flex-wrap items-center gap-4 p-5"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300 ">
                <ListChecks className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">
                  {opsLoading
                    ? "正在加载今日待办"
                    : opsError
                      ? "今日待办加载失败"
                      : todoCount > 0
                        ? `${todoCount} 项待办需要处理`
                        : "今日待办已处理完"}
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 ">
                  请假审批、补课安排与课时跟进
                </p>
              </div>
              {opsError ? (
                <Button variant="outline" onClick={() => retryOps()}>
                  重试
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/admin/operations">查看待办</Link>
                </Button>
              )}
            </Card>

            {/* Low balance widget */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">课时预警</h2>
                <Link
                  to="/admin/alerts"
                  className="text-xs text-primary-700 hover:underline dark:text-primary-300 "
                >
                  查看全部 →
                </Link>
              </div>
              <LowBalanceWidget />
            </section>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">快捷操作</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { to: "/schedule", label: "排课与调课" },
                  { to: "/students", label: "学员与缴费" },
                  { to: "/leave", label: "请假审批" },
                  { to: "/admin/notifications", label: "发送站内通知" },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-lg bg-primary-50 px-3 py-3 text-center text-xs font-medium text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </Card>
          </aside>
        </div>
        <details
          className="group overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          onToggle={(event) => setAnalyticsOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <TrendingUp className="h-4 w-4 text-primary-700 dark:text-primary-300 " />
            经营分析
            <ChevronDown className="ml-auto h-4 w-4 text-gray-500 transition-transform group-open:rotate-180 dark:text-gray-400 " />
          </summary>
          {analyticsOpen && (
            <div className="border-t border-slate-100 p-4 sm:p-5 dark:border-gray-800">
              <Suspense fallback={<Loading />}>
                <DashboardCharts />
              </Suspense>
            </div>
          )}
        </details>
      </main>
    </div>
  );
}
