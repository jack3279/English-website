import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ListChecks, ClipboardCheck, CalendarClock, CalendarX2, FileWarning, UserPlus, CreditCard, ChevronRight, PartyPopper, RefreshCw } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Button } from "../../components/ui/button.jsx";

// 图标按 kind 走, 与后端 routes/operations.js 的 kind 一一对应
const KIND_ICON = {
  leave: ClipboardCheck,
  makeup: CalendarClock,
  lesson: CalendarX2,
  report: FileWarning,
  lead: UserPlus,
  finance: CreditCard
};
const SEVERITY = {
  danger: {
    dot: "bg-danger-600",
    text: "text-danger-600 dark:text-danger-300 ",
    chip: "bg-danger-50 text-danger-700 border-danger-200 dark:bg-danger-900/25 dark:text-danger-300 dark:border-danger-800 "
  },
  warning: {
    dot: "bg-warning-500",
    text: "text-warning-600 dark:text-warning-300 ",
    chip: "bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-900/25 dark:text-warning-300 dark:border-warning-800 "
  },
  info: {
    dot: "bg-primary-500",
    text: "text-primary-700 dark:text-primary-300 ",
    chip: "bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-950/40 dark:text-primary-300 dark:border-primary-800 "
  }
};
const SEVERITY_LABEL = () => ({
  danger: uiT("紧急"),
  warning: uiT("待处理"),
  info: uiT("关注")
});

// 「有待办」的组做成卡片; 「没有待办」的组收成一行细列表（见下面的 EmptyRow）。
//
// 之前 7 个组一律是等大的卡片, 上面还各压一条 4px 彩色左边框:
// 5 个空的和 2 个真有事的占一样篇幅, 既噪又空。现在只让"有事的"占版面。
const MAX_CHIPS = 4; // 标签只显示关键的几个, 其余收进 "还有 N 条"

function GroupCard({
  group
}) {
  useUiLanguage();
  const Icon = KIND_ICON[group.kind] ?? ListChecks;
  const tone = SEVERITY[group.severity] ?? SEVERITY.info;
  const chips = group.items.slice(0, MAX_CHIPS);
  const restCount = group.count - chips.length;
  return <Card className="p-5 transition-shadow duration-200 hover:shadow-card-hover">
      <Link to={group.link} className="group block">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {uiT(group.title)}
                </span>
                <Badge className={tone.chip}>{SEVERITY_LABEL()[group.severity]}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{uiT(group.hint)}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={`text-2xl font-semibold tabular-nums ${tone.text}`}>
              {group.count}
            </span>
            <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-primary-700 dark:text-gray-400 dark:group-hover:text-primary-300 " />
          </div>
        </div>

        {chips.length > 0 && <div className="mt-3.5 flex flex-wrap gap-1.5">
            {chips.map(it => <span key={it.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100/80 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                <span className="font-medium">{it.name}</span>
                {it.sub && <span className="text-gray-500 dark:text-gray-400">{it.sub}</span>}
              </span>)}
            {restCount > 0 && <span className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">{" " + uiT("还有") + " "}{restCount}{" " + uiT("条") + " "}</span>}
          </div>}
      </Link>
      {group.key === "missing_feedback" && <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          {(group.items || []).map(item => <Link key={item.id} to={`/teacher/feedback/${item.id}`} className="block rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
              {item.name}{" " + uiT("· 补发上课确认 ›") + " "}</Link>)}
        </div>}
    </Card>;
}

// 没有待办的组: 一行搞定, 不占卡片。想点进去仍然可以点。
function EmptyRow({
  group
}) {
  useUiLanguage();
  const Icon = KIND_ICON[group.kind] ?? ListChecks;
  return <Link to={group.link} className="flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/50">
      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-400" />
      <span className="text-sm text-gray-500 dark:text-gray-400">{uiT(group.title)}</span>
      <span className="ml-auto text-xs text-gray-300 dark:text-gray-400">{uiT("无")}</span>
    </Link>;
}
export default function OperationsPage({
  teachingOnly = false
}) {
  useUiLanguage();
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching
  } = useQuery({
    queryKey: ["operations", "todo"],
    queryFn: async () => (await http("/operations")).data,
    refetchInterval: 120000
  });
  const groups = (data?.groups ?? []).filter(group => !teachingOnly || ["leave", "makeup", "lesson", "report"].includes(group.kind));
  const summary = teachingOnly ? {
    total: groups.reduce((sum, g) => sum + g.count, 0),
    openKinds: groups.filter(g => g.count).length,
    danger: 0
  } : data?.summary ?? {
    total: 0,
    openKinds: 0,
    danger: 0
  };
  const allClear = !isLoading && !error && summary.total === 0;
  return <div className="min-h-full">
      <PageHeader icon={ListChecks} title={teachingOnly ? uiT("教学待办") : uiT("教务待办")} subtitle={isLoading ? uiT("加载中…") : allClear ? uiT("今天没有待办") : uiT("{0} 类待办 · 共 {1} 项", [summary.openKinds, summary.total])} actions={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? uiT("刷新中…") : uiT("刷新")}
          </Button>} />

      <main className="page-body space-y-4">
        {error && <Card className="p-4 bg-danger-50 border-danger-200 text-danger-700 text-sm dark:bg-danger-900/25 dark:border-danger-800 dark:text-danger-300 ">{" " + uiT("加载失败:") + " "}{error.message}
          </Card>}

        {isLoading && <LoadingCard />}

        {allClear && !error && <Card className="p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-success-50 dark:bg-success-900/30 flex items-center justify-center mb-3">
              <PartyPopper className="w-7 h-7 text-success-500" />
            </div>
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{" " + uiT("全部清空 🎉") + " "}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{" " + uiT("请假、补课、线索、销课、续费都没有待处理项") + " "}</div>
          </Card>}

        {!isLoading && groups.filter(g => g.count > 0).map(g => <GroupCard key={g.key} group={g} />)}

        {/* 没有待办的组收成一行一条, 放在下面 —— 让"有事的"独占版面 */}
        {!isLoading && groups.some(g => g.count === 0) && <div className="pt-1">
            <div className="px-4 pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">{" " + uiT("暂无待办") + " "}</div>
            {groups.filter(g => g.count === 0).map(g => <EmptyRow key={g.key} group={g} />)}
          </div>}

        {!isLoading && groups.length > 0 && <div className="pt-2 text-center text-xs text-gray-500 dark:text-gray-400">{" " + uiT("待办口径与财务页、定时提醒共用一套判定；点卡片直接跳到对应页面处理") + " "}</div>}
      </main>
    </div>;
}
