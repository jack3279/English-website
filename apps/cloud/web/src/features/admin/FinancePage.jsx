import { financeRange } from "../../lib/financeWindow.js";
import { useState } from "react";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  Users,
  AlertCircle,
  DollarSign,
  Calendar,
  AlertTriangle,
  Clock,
  ChevronDown,
  Download,
  Receipt,
  Search,
} from "lucide-react";
import { http } from "../../lib/http.js";
import { downloadCsv, safeFilename } from "../../lib/csv.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import RevenueDetailModal from "./RevenueDetailModal.jsx";
import StudentFinancialModal from "./StudentFinancialModal.jsx";

function yuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

// 周期切换。原来页面写死只显示「本月」, 想看上月或近 30 天只能改代码。
// 每个接口传同一北京时间区间，避免汇总按月而明细按全部历史。
const PRESETS = [
  { key: "this_month", label: "本月" },
  { key: "last_30", label: "近 30 天" },
  { key: "quarter", label: "本季度" },
  { key: "all", label: "全部" },
];

function withRange(path, range) {
  const qs = new URLSearchParams();
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function StatTile({ title, value, sub, icon: Icon, tone = "primary" }) {
  const tones = {
    primary: "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300",
    success: "bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-300",
    warning: "bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-300",
    danger: "bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-300",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-xl sm:text-2xl font-semibold tabular-nums break-all text-gray-900 dark:text-gray-100">
        {value}
      </div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    </Card>
  );
}

export default function FinancePage() {
  const { data: balanceReport, isError: balanceError } = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    refetchInterval: 60000,
  });
  const lowBalanceCount = balanceReport
    ? (balanceReport.low_balance?.length ?? 0) + (balanceReport.zero_balance?.length ?? 0)
    : null;
  const [preset, setPreset] = useState("this_month");
  const [detailRow, setDetailRow] = useState(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const range = financeRange(preset);

  const {
    data: summary,
    isLoading,
    error: summaryError,
    refetch: retrySummary,
  } = useQuery({
    queryKey: ["finance", "summary", preset, range.from, range.to],
    queryFn: async () => (await http(withRange("/finance/summary", range))).data,
  });
  const { data: exceptions } = useQuery({
    queryKey: ["finance", "exceptions"],
    queryFn: async () => (await http("/finance/exceptions")).data,
    refetchInterval: 60000,
  });
  const {
    data: revenue,
    error: revenueError,
    refetch: retryRevenue,
  } = useQuery({
    queryKey: ["finance", "revenue", preset, range.from, range.to],
    queryFn: async () => (await http(withRange("/finance/revenue", range))).data,
  });
  const {
    data: renewals,
    error: renewalError,
    refetch: retryRenewals,
  } = useQuery({
    queryKey: ["finance", "renewals"],
    queryFn: async () => (await http("/finance/renewals")).data,
  });

  const revenueRows = revenue?.rows ?? [];
  const renewalRows = renewals?.rows ?? [];

  function exportRevenue() {
    downloadCsv(
      safeFilename(`营收明细_${PRESETS.find((p) => p.key === preset).label}.csv`),
      ["日期", "学员", "课时包", "金额(元)", "支付方式", "备注"],
      revenueRows.map((r) => [
        r.paid_at
          ? new Date(r.paid_at).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour12: false,
            })
          : "",
        r.student_name,
        r.package_name,
        yuan(r.amount_cents),
        r.method ?? "",
        r.notes ?? "",
      ]),
    );
  }

  function exportRenewals() {
    downloadCsv(
      "续费清单.csv",
      ["学员", "联系电话", "课时包", "剩余课时", "总量", "到期日", "提醒原因"],
      renewalRows.map((r) => [
        r.student_name,
        r.phone,
        r.package_name,
        r.remaining_hours,
        r.total_hours,
        r.expires_at
          ? new Date(r.expires_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
          : "",
        r.stage === "expiring" ? "即将到期" : "余量不足",
      ]),
    );
  }

  const expiring = exceptions?.expiring_soon ?? [];
  const negBal = exceptions?.negative_balance ?? [];
  const hasException = expiring.length + negBal.length > 0;

  return (
    <div className="min-h-full admin-mobile-page">
      <PageHeader
        icon={TrendingUp}
        title="财务报表"
        subtitle={
          summary
            ? range.from
              ? `${range.from} ~ ${range.to} · 自动汇总`
              : "本月实时数据 · 自动汇总"
            : "加载中…"
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowStudentModal(true)}>
            <Search className="w-3.5 h-3.5 mr-1" /> 学员账单
          </Button>
        }
      />

      <main className="page-body space-y-6">
        <Card className="p-4 border-primary-200 bg-primary-50 md:hidden dark:bg-primary-950 dark:border-primary-800 ">
          <h2 className="font-semibold text-primary-800 dark:text-primary-200">学生收费 · CNY ¥</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
            外教课酬按各教师设置的币种单独结算。
          </p>
          <Link
            className="mt-3 inline-block text-sm font-medium text-primary-700 dark:text-primary-200"
            to="/admin/payroll"
          >
            查看教师课酬 ›
          </Link>
        </Card>
        {/* 周期切换 */}
        <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
          <Segmented value={preset} onChange={setPreset} items={PRESETS} />
        </Card>

        {/* Stats grid */}
        {summaryError && (
          <Card className="p-5" role="alert">
            财务汇总读取失败，暂不能确认金额。
            <Button variant="outline" className="ml-3" onClick={() => retrySummary()}>
              重试
            </Button>
          </Card>
        )}
        {isLoading ? (
          <LoadingCard />
        ) : summary ? (
          <>
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">收入构成 · CNY</h2>
                <Link
                  to="/admin/payroll"
                  className="text-sm text-primary-700 dark:text-primary-300"
                >
                  教师课酬按币种独立查看 ›
                </Link>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["课时收费", summary.this_month.received_cents],
                  ["退款冲减", summary.this_month.refunded_cents],
                  ["净收入", summary.this_month.revenue_cents],
                ].map(([label, cents]) => (
                  <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-800/50" key={label}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {cents == null ? "—" : `¥${yuan(cents)}`}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                净收入 = 本期课时收费 −
                退款。课时收费包含新购与续费；教师课酬按币种独立核算，不与人民币金额直接相加或相减。
              </p>
            </Card>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <StatTile
                title={`${PRESETS.find((p) => p.key === preset).label}营收`}
                value={`¥${yuan(summary.this_month.revenue_cents)}`}
                sub={`上一周期 ¥${yuan(summary.last_month.revenue_cents)}`}
                icon={DollarSign}
                tone="primary"
              />
              <StatTile
                title={`${PRESETS.find((p) => p.key === preset).label}消耗课时`}
                value={`${summary.this_month.consumed_hours}h`}
                sub={`完课 ${summary.this_month.completed_lessons} 节`}
                icon={Clock}
                tone="success"
              />
              <StatTile
                title="在读学员"
                value={summary.total.active_students}
                sub={`全部 ${summary.total.all_students}`}
                icon={Users}
                tone="primary"
              />
              <StatTile
                title="需关注课时"
                value={lowBalanceCount ?? "—"}
                sub={
                  balanceError
                    ? "预警数据加载失败"
                    : `在读学员剩余不足 ${balanceReport?.threshold ?? 3} 小时`
                }
                icon={AlertCircle}
                tone={lowBalanceCount > 0 ? "warning" : "primary"}
              />
            </div>

            {/* 异常面板 */}
            {hasException && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning-500" />
                    财务异常
                  </h2>
                  {hasException && (
                    <Badge variant="warning">{expiring.length + negBal.length} 条</Badge>
                  )}
                </div>

                {expiring.length > 0 && (
                  <Card className="overflow-hidden p-0 mb-3">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-warning-50 dark:bg-warning-900/20">
                      <h3 className="text-sm font-semibold text-warning-700 dark:text-warning-300 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        课时包即将到期 (含已过期)
                      </h3>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {expiring.map((e) => (
                        <li
                          key={e.package_id}
                          className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30"
                        >
                          <Link
                            to={`/students/${e.student_id}`}
                            className="flex items-center gap-3 min-w-0 flex-1"
                          >
                            <div className="w-9 h-9 rounded-full bg-warning-100 dark:bg-warning-900/40 text-warning-600 dark:text-warning-300 font-semibold flex items-center justify-center shrink-0">
                              {(e.student_name || "?").charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                                {e.student_name}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {e.package_name} · 剩余 {e.remaining_hours}h
                              </div>
                            </div>
                          </Link>
                          <div className="text-right shrink-0 ml-3">
                            <Badge variant={e.kind === "expired" ? "destructive" : "warning"}>
                              {e.kind === "expired" ? "已过期" : "7 天内到期"}
                            </Badge>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              <Calendar className="w-3 h-3 inline mr-0.5" />
                              {new Date(e.expires_at).toLocaleDateString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                              })}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {negBal.length > 0 && (
                  <Card className="overflow-hidden p-0">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-danger-50 dark:bg-danger-900/20">
                      <h3 className="text-sm font-semibold text-danger-700 dark:text-danger-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        课时余额为负 (异常)
                      </h3>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {negBal.map((b) => (
                        <li
                          key={b.student_id}
                          className="px-5 py-3 flex items-center justify-between"
                        >
                          <Link
                            to={`/students/${b.student_id}`}
                            className="font-medium text-gray-900 dark:text-gray-100 text-sm hover:text-primary-700 dark:hover:text-primary-300 "
                          >
                            {b.student_name}
                          </Link>
                          <div className="text-danger-600 dark:text-danger-400 font-bold text-sm">
                            {b.remaining_hours}h
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </section>
            )}

            {/* 营收明细 */}
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-primary-500" />
                  收支明细
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {revenueError
                      ? "金额未能确认"
                      : `${revenueRows.length} 笔 · 合计 ¥${yuan(revenue?.total_cents ?? 0)}`}
                  </span>
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportRevenue}
                  disabled={revenueRows.length === 0}
                >
                  <Download className="w-3 h-3 mr-1" />
                  导出 CSV
                </Button>
              </div>

              {revenueError && (
                <Card className="p-5" role="alert">
                  收支明细读取失败{" "}
                  <Button variant="outline" onClick={() => retryRevenue()}>
                    重试
                  </Button>
                </Card>
              )}
              {revenue?.truncated && (
                <div className="mb-2 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded px-3 py-2 dark:text-warning-300 dark:bg-warning-900/25 dark:border-warning-800 ">
                  区间内记录超过 500 笔, 这里只显示最近 500 笔。需要全量请按季度查看。
                </div>
              )}

              {revenueError ? null : revenueRows.length === 0 ? (
                <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  该区间内没有缴费记录
                </Card>
              ) : (
                <Card className="overflow-hidden p-0">
                  <Table aria-label="缴费明细" className="sm:min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>学员</TableHead>
                        <TableHead>缴费时间</TableHead>
                        <TableHead>课时包</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                        <TableHead>方式</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueRows.slice(0, 20).map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30"
                          onClick={() => setDetailRow(r)}
                          title="点击查看详情"
                        >
                          <TableCell>
                            <Link
                              to={`/students/${r.student_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-700 dark:hover:text-primary-300 "
                            >
                              {r.student_name}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            <time dateTime={r.paid_at}>
                              {new Date(r.paid_at).toLocaleDateString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                              })}
                            </time>
                            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400 ">
                              {new Date(r.paid_at).toLocaleTimeString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                                hour12: false,
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                            {r.package_name}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-gray-900 dark:text-gray-100">
                            ¥{yuan(r.amount_cents)}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 dark:text-gray-400">
                            {r.method ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailRow(r);
                              }}
                            >
                              查看详情
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {revenueRows.length > 20 && (
                    <div className="px-5 py-2.5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
                      仅显示最近 20 笔, 完整清单请导出 CSV
                    </div>
                  )}
                </Card>
              )}
            </section>

            {/* 续费清单 */}
            <details className="group rounded-xl border border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                续费跟进{" "}
                {renewalRows.length > 0 && <Badge variant="warning">{renewalRows.length} 人</Badge>}
                <ChevronDown className="ml-auto h-4 w-4 text-gray-500 group-open:rotate-180 dark:text-gray-400 " />
              </summary>
              <div className="border-t border-slate-100 p-4 dark:border-gray-800">
                <div className="mb-3 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportRenewals}
                    disabled={renewalRows.length === 0}
                  >
                    <Download className="w-3 h-3 mr-1" />
                    导出 CSV
                  </Button>
                </div>

                {renewalError ? (
                  <Card className="p-5" role="alert">
                    续费清单读取失败{" "}
                    <Button variant="outline" onClick={() => retryRenewals()}>
                      重试
                    </Button>
                  </Card>
                ) : renewalRows.length === 0 ? (
                  <Card className="p-8 text-center">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      暂无需要续费的学员
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      课时余量不足或课时包临近到期时会出现在这里
                    </div>
                  </Card>
                ) : (
                  <Card className="overflow-hidden p-0">
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {renewalRows.slice(0, 20).map((r) => (
                        <li
                          key={r.student_id}
                          className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30"
                        >
                          <Link
                            to={`/students/${r.student_id}`}
                            className="flex items-center gap-3 min-w-0 flex-1"
                          >
                            <div className="w-9 h-9 rounded-full bg-warning-100 dark:bg-warning-900/40 text-warning-600 dark:text-warning-300 font-semibold flex items-center justify-center shrink-0">
                              {(r.student_name || "?").charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                                {r.student_name}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {r.package_name} · 剩余 {r.remaining_hours}h / {r.total_hours}h
                                {r.phone && <span className="ml-1.5">· {r.phone}</span>}
                              </div>
                            </div>
                          </Link>
                          <div className="text-right shrink-0 ml-3">
                            <Badge variant={r.stage === "expiring" ? "warning" : "secondary"}>
                              {r.stage === "expiring" ? "即将到期" : "余量不足"}
                            </Badge>
                            {r.expires_at && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                <Calendar className="w-3 h-3 inline mr-0.5" />
                                {new Date(r.expires_at).toLocaleDateString("zh-CN", {
                                  timeZone: "Asia/Shanghai",
                                })}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            </details>
          </>
        ) : null}
      </main>

      {detailRow && <RevenueDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
      {showStudentModal && <StudentFinancialModal onClose={() => setShowStudentModal(false)} />}
    </div>
  );
}
