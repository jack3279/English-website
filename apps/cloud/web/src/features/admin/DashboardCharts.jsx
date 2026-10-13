import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users, AlertCircle, Wallet, CheckCircle2 } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";

// 把 cents 转换为 "¥1.2k" / "¥1.5万" 这种压缩写法
function yuanShort(cents) {
  const yuan = Number(cents || 0) / 100;
  if (yuan >= 10000) return `¥${(yuan / 10000).toFixed(1)}万`;
  if (yuan >= 1000) return `¥${(yuan / 1000).toFixed(1)}k`;
  return `¥${yuan.toFixed(0)}`;
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 取最近 n 个月每个月的 [from, to]
function lastNMonths(n) {
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${d.getMonth() + 1}月`,
      from: ymd(d),
      to: ymd(to),
    });
  }
  return months;
}

function Kpi({ title, value, sub, icon: Icon, tone = "primary" }) {
  const tones = {
    primary: "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300",
    success: "bg-success-50 text-success-600 dark:bg-success-900/25 dark:text-success-300",
    warning: "bg-warning-50 text-warning-600 dark:bg-warning-900/25 dark:text-warning-300",
    danger: "bg-danger-50 text-danger-600 dark:bg-danger-900/25 dark:text-danger-300",
  };
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-900/[0.04] dark:bg-gray-900 dark:ring-white/[0.06]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</span>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// 纯 SVG 柱状图 —— 不引第三方库, 体积可控
function RevenueBarChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400">
        暂无数据
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.amount), 1);
  const W = 480;
  const H = 160;
  const padding = { top: 12, right: 8, bottom: 28, left: 36 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barGap = 8;
  const barW = (chartW - barGap * (data.length - 1)) / data.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-48"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="近 6 个月营收"
    >
      {/* y 轴基线 + 2 条参考线 */}
      {[0, 0.5, 1].map((p, i) => {
        const y = padding.top + chartH * (1 - p);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              x2={padding.left + chartW}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-gray-200 dark:text-gray-700"
              strokeWidth="1"
              strokeDasharray={i === 0 ? "0" : "3 3"}
            />
            <text
              x={padding.left - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-gray-500 dark:fill-gray-400"
              fontSize="10"
            >
              {yuanShort(max * p)}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const h = (d.amount / max) * chartH;
        const x = padding.left + i * (barW + barGap);
        const y = padding.top + chartH - h;
        const isCurrent = i === data.length - 1;
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="3"
              className={
                isCurrent
                  ? "fill-primary-600 dark:fill-primary-400"
                  : "fill-primary-300 dark:fill-primary-700"
              }
            >
              <title>
                {d.label}: {yuanShort(d.amount)}
              </title>
            </rect>
            <text
              x={x + barW / 2}
              y={padding.top + chartH + 16}
              textAnchor="middle"
              className="fill-gray-500 dark:fill-gray-400"
              fontSize="10"
            >
              {d.label}
            </text>
            {d.amount > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-gray-700 dark:fill-gray-300"
                fontSize="10"
                fontWeight="600"
              >
                {yuanShort(d.amount)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 经营分析：营收趋势与教学交付概况。
 * 数据源: /finance/summary (KPI), /finance/revenue (近 6 月按月 group),
 */
export default function DashboardCharts() {
  const { data: balanceReport, isError: balanceError } = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    refetchInterval: 60000,
  });
  const lowBalanceCount = balanceReport
    ? (balanceReport.low_balance?.length ?? 0) + (balanceReport.zero_balance?.length ?? 0)
    : null;
  const months = useMemo(() => lastNMonths(6), []);

  // 1. KPI (本月)
  const { data: summary, isLoading: lS } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => (await http("/finance/summary")).data,
  });

  // 2. 6 个月营收 (按月 group; 一个 query 拿所有, 然后 JS 分桶)
  const { data: allRev, isLoading: lR } = useQuery({
    queryKey: ["dashboard", "revenue", "6m"],
    queryFn: async () => {
      // 用最大窗口覆盖 6 个月, 一发到位
      const from = months[0].from;
      const to = months[months.length - 1].to;
      const r = await http(`/finance/revenue?from=${from}&to=${to}&limit=500`);
      return r.data?.rows ?? [];
    },
  });

  // 4. 本月课节统计 (完课率 / 出勤率)
  const monthStart = months[months.length - 1].from; // 最近一个月的第一天
  const today = months[months.length - 1].to; // 范围结尾
  const { data: lessonStats, isLoading: lLS } = useQuery({
    queryKey: ["dashboard", "lesson-stats", monthStart, today],
    queryFn: async () => {
      const r = await http(`/reports/lesson-stats?from=${monthStart}&to=${today}`);
      return r.data;
    },
  });

  // 5. 按老师完课率排名
  const { data: teacherAtt, isLoading: lTA } = useQuery({
    queryKey: ["dashboard", "teacher-attendance", monthStart, today],
    queryFn: async () => {
      const r = await http(`/reports/teacher-attendance?from=${monthStart}&to=${today}`);
      return r.data;
    },
  });

  // 把 revenue rows 按 paid_at YYYY-MM 分桶求和
  const monthly = useMemo(() => {
    const map = new Map();
    for (const r of allRev ?? []) {
      const k = r.paid_at?.slice(0, 7);
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + Number(r.amount_cents || 0));
    }
    return months.map((m) => ({ key: m.key, label: m.label, amount: map.get(m.key) ?? 0 }));
  }, [allRev, months]);

  const isLoading = lS || lR || lLS;
  const tm = summary?.this_month ?? {};
  const total = summary?.total ?? {};

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-slate-500 dark:text-gray-400">本月经营</h2>
        {summary?.period?.from && (
          <span className="text-xs text-slate-500 dark:text-gray-400">
            {summary.period.from} 至 {summary.period.to}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="h-[92px] animate-pulse bg-slate-100/80 dark:bg-gray-800" />
          ))
        ) : (
          <>
            <Kpi
              title="本月营收"
              value={yuanShort(tm.revenue_cents ?? 0)}
              sub={`上月 ${yuanShort(summary?.last_month?.revenue_cents ?? 0)}`}
              icon={Wallet}
              tone="primary"
            />
            <Kpi
              title="完课率"
              value={`${Math.round((lessonStats?.completion_rate ?? 0) * 100)}%`}
              sub={`${lessonStats?.completed ?? 0} / ${lessonStats?.total_scheduled ?? 0} 节`}
              icon={CheckCircle2}
              tone={(lessonStats?.completion_rate ?? 0) >= 0.8 ? "success" : "primary"}
            />
            <Kpi
              title="在读学员"
              value={total.active_students ?? 0}
              sub={`课消 ${tm.consumed_hours ?? 0}h`}
              icon={Users}
              tone="primary"
            />
            <Kpi
              title="低余额"
              value={lowBalanceCount ?? "—"}
              sub={balanceError ? "余额预警加载失败" : "在读学员剩余不足 3 小时"}
              icon={AlertCircle}
              tone={lowBalanceCount > 0 ? "warning" : "primary"}
            />
          </>
        )}
      </div>

      {/* 趋势 + 课酬 */}
      <div className="space-y-3">
        <Card className="p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              近 6 个月营收
            </h3>
            <Link
              to="/admin/finance"
              className="text-xs text-primary-700 dark:text-primary-400 hover:underline"
            >
              查看明细 →
            </Link>
          </div>
          {lR ? (
            <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-gray-800" />
          ) : (
            <RevenueBarChart data={monthly} />
          )}
        </Card>
      </div>

      {/* 按老师完课率 (本月) —— 一行表格 */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            老师完课率排名 (本月)
          </h3>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            按实际完课时数降序 · 排除已取消
          </span>
        </div>
        {lTA ? (
          <div className="mx-5 mb-5 h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-gray-800" />
        ) : (teacherAtt?.rows ?? []).length === 0 ? (
          <div className="h-20 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400">
            本月暂无老师课节数据
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <Table className="w-full text-sm">
              <TableHeader className="text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <TableRow>
                  <TableHead className="text-left py-1.5 font-medium">老师</TableHead>
                  <TableHead className="text-right py-1.5 font-medium">课时数</TableHead>
                  <TableHead className="text-right py-1.5 font-medium">完课率</TableHead>
                  <TableHead className="text-right py-1.5 font-medium">出勤率</TableHead>
                  <TableHead className="text-right py-1.5 font-medium">取消</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
                {(teacherAtt.rows ?? []).map((t) => (
                  <TableRow key={t.teacher_id} className="text-xs">
                    <TableCell className="py-2 font-medium text-gray-900 dark:text-gray-100">
                      {t.teacher_name || (t.teacher_id?.slice(0, 8) ?? "—")}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {t.total_hours.toFixed(1)}h
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <span
                        className={`tabular-nums font-semibold ${
                          t.completion_rate >= 0.9
                            ? "text-success-700 dark:text-success-300"
                            : t.completion_rate >= 0.7
                              ? "text-primary-700 dark:text-primary-300"
                              : "text-warning-700 dark:text-warning-300"
                        }`}
                      >
                        {Math.round(t.completion_rate * 100)}%
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {Math.round(t.attendance_rate * 100)}%
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {t.cancelled}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  );
}
