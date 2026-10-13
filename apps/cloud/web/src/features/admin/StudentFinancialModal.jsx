import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  Loader2,
  Wallet,
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Package,
} from "lucide-react";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Button } from "../../components/ui/button.jsx";
import { http } from "../../lib/http.js";

function yuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/**
 * 按学员财务追溯 —— 输入学员 ID 或姓名 (模糊)，后端拉该学员的
 * packages / lesson_transactions / package_payments 合并成时间线。
 *
 * 用途: 财务页"为什么这个月余额对不上""某笔课消对应哪节课"等场景。
 */
export default function StudentFinancialModal({ onClose }) {
  const [q, setQ] = useState("");
  const [studentId, setStudentId] = useState(null);
  const searchRef = useRef(null);

  // 替代 autoFocus prop —— 弹窗打开后聚焦搜索框, 不触发 a11y 警告。
  useEffect(() => {
    if (!studentId) searchRef.current?.focus();
  }, [studentId]);

  // 模糊搜学员 —— 复用 /students?search=
  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ["fin-student-search", q],
    queryFn: async () => {
      if (!q.trim()) return { items: [] };
      const r = await http(`/students?search=${encodeURIComponent(q.trim())}&pageSize=8`);
      return { items: r.data ?? [] };
    },
    enabled: q.trim().length >= 1,
    staleTime: 30_000,
  });
  const candidates = searchData?.items ?? [];

  // 选中后拉财务详情
  const { data: fin, isLoading: loadingFin } = useQuery({
    queryKey: ["fin-student", studentId],
    queryFn: async () => (await http(`/finance/student/${studentId}`)).data,
    enabled: !!studentId,
  });

  const timeline = useMemo(() => {
    if (!fin) return [];
    const items = [];
    for (const p of fin.payments ?? []) {
      items.push({
        kind: "payment",
        ts: p.paid_at,
        amount_cents: Number(p.amount_cents),
        method: p.method,
        notes: p.notes,
        package_id: p.student_package_id,
      });
    }
    for (const t of fin.transactions ?? []) {
      items.push({
        kind: "tx",
        ts: t.created_at,
        delta: Number(t.delta),
        reason: t.reason,
        notes: t.note,
        lesson_id: t.lesson_id,
      });
    }
    items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return items;
  }, [fin]);

  const totalPaid = fin?.total_paid_cents ?? 0;
  const consumed = (fin?.transactions ?? [])
    .filter((t) => t.reason === "consume")
    .reduce((s, t) => s + Math.abs(Number(t.delta)), 0);
  const manualAdj = (fin?.transactions ?? [])
    .filter((t) => t.reason === "adjust")
    .reduce((s, t) => s + Number(t.delta), 0);

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary-700 dark:text-primary-300 " />
          <span>按学员追溯</span>
        </div>
      }
      maxWidth="lg"
    >
      <div className="space-y-4">
        {!studentId ? (
          <div className="space-y-2">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              输入学员姓名 (1 个字以上即可) 或粘贴学员 ID。
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如 张 / Tom / 9c4e..."
                className="pl-9"
              />
            </div>

            <div className="min-h-[160px]">
              {searching && q ? (
                <div className="py-6 text-center text-xs text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-3 h-3 inline mr-1 animate-spin" /> 搜索中…
                </div>
              ) : candidates.length === 0 && q ? (
                <div className="py-6 text-center text-xs text-gray-500 dark:text-gray-400">
                  没有匹配「{q}」的学员
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-md border border-gray-200 dark:border-gray-700 max-h-72 overflow-y-auto">
                  {candidates.map((s) => (
                    <li key={s.id} className="flex">
                      <button
                        type="button"
                        className="flex-1 text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 flex items-center justify-between"
                        onClick={() => {
                          setStudentId(s.id);
                          setQ(s.full_name);
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-semibold flex items-center justify-center">
                            {(s.full_name || "?").charAt(0)}
                          </div>
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            {s.full_name}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          余额 {Number(s.remaining_hours ?? 0).toFixed(1)}h
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <>
            {loadingFin ? (
              <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> 加载财务数据…
              </div>
            ) : fin ? (
              <>
                {/* 顶部摘要 */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {fin.student?.full_name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {fin.packages?.length ?? 0} 个课时包 · {fin.transactions?.length ?? 0} 条流水
                      · {fin.payments?.length ?? 0} 笔缴费
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setStudentId(null)}>
                    ← 换一个学员
                  </Button>
                </div>

                <div className="grid sm:grid-cols-3 gap-2">
                  <SummaryTile
                    icon={Receipt}
                    label="累计缴费"
                    value={`¥${yuan(totalPaid)}`}
                    tone="primary"
                  />
                  <SummaryTile
                    icon={ArrowDownRight}
                    label="累计课消"
                    value={`${consumed.toFixed(1)}h`}
                    tone="warning"
                  />
                  <SummaryTile
                    icon={ArrowUpRight}
                    label="人工调整"
                    value={`${manualAdj >= 0 ? "+" : ""}${manualAdj.toFixed(1)}h`}
                    tone={manualAdj >= 0 ? "success" : "destructive"}
                  />
                </div>

                {/* 课时包 */}
                {fin.packages?.length > 0 && (
                  <Card className="overflow-hidden p-0">
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-2">
                      <Package className="w-3.5 h-3.5" /> 课时包
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                      {fin.packages.map((p) => (
                        <li key={p.id} className="px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {p.package_types?.name ?? "?"}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              ¥{yuan(p.package_types?.price_cents ?? 0)} · 购于{" "}
                              {new Date(p.purchased_at).toLocaleDateString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                              })}
                              {p.expires_at && (
                                <span className="ml-1">
                                  · 到期{" "}
                                  {new Date(p.expires_at).toLocaleDateString("zh-CN", {
                                    timeZone: "Asia/Shanghai",
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">
                              {Number(p.remaining_hours).toFixed(1)}h
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              / {Number(p.total_hours).toFixed(1)}h
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* 时间线 */}
                <div>
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
                    时间线（缴费 + 课消,最新在上）
                  </div>
                  {timeline.length === 0 ? (
                    <Card className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      该学员尚无缴费 / 课消记录
                    </Card>
                  ) : (
                    <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {timeline.map((it, i) => (
                        <TimelineRow key={i} item={it} studentId={studentId} />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <div className="py-6 text-center text-sm text-danger-600 dark:text-danger-300 ">
                加载失败
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SummaryTile({ icon: Icon, label, value, tone }) {
  const tones = {
    primary: "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300",
    warning: "bg-warning-50 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300",
    success: "bg-success-50 dark:bg-success-900/30 text-success-700 dark:text-success-300",
    destructive: "bg-danger-50 dark:bg-danger-900/30 text-danger-700 dark:text-danger-300",
  };
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div className={`w-5 h-5 rounded flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-3 h-3" />
        </div>
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">{value}</div>
    </div>
  );
}

const REASON_LABEL = {
  consume: "消课",
  adjust: "人工调整",
  purchase: "购包入账",
  refund: "退费",
};

function TimelineRow({ item, studentId }) {
  const isPayment = item.kind === "payment";
  const isConsume = item.kind === "tx" && item.reason === "consume";
  const tone = isPayment
    ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
    : isConsume
      ? "bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400"
      : item.delta >= 0
        ? "bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400"
        : "bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-400";

  return (
    <li className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 flex items-start gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${tone}`}>
        {isPayment ? (
          <Receipt className="w-3.5 h-3.5" />
        ) : isConsume ? (
          <ArrowDownRight className="w-3.5 h-3.5" />
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {isPayment ? (
              item.amount_cents < 0 ? (
                <>
                  退费 · {item.method || "—"} ·{" "}
                  <span className="text-danger-700 dark:text-danger-300">
                    -¥{yuan(Math.abs(item.amount_cents))}
                  </span>
                </>
              ) : (
                <>
                  缴费 · {item.method || "—"} ·{" "}
                  <span className="text-primary-700 dark:text-primary-300">
                    +¥{yuan(item.amount_cents)}
                  </span>
                </>
              )
            ) : (
              <>
                {REASON_LABEL[item.reason] || item.reason} ·{" "}
                <span
                  className={
                    item.delta >= 0
                      ? "text-success-700 dark:text-success-300"
                      : "text-danger-700 dark:text-danger-300"
                  }
                >
                  {item.delta >= 0 ? "+" : ""}
                  {Number(item.delta).toFixed(1)}h
                </span>
              </>
            )}
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {new Date(item.ts).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour12: false,
            })}
          </span>
        </div>
        {item.notes && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">
            {item.notes}
          </div>
        )}
        {!isPayment && item.lesson_id && (
          <div className="text-xs mt-1">
            <Link
              to={`/students/${studentId}`}
              className="text-primary-700 dark:text-primary-400 hover:underline"
            >
              查看对应课节 →
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}
