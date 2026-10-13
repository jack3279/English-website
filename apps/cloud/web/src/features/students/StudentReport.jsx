import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, UserX, CheckCircle2, Download, TrendingUp } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { schoolPeriod } from "../../lib/schoolPeriod.js";
const RANGES = () => [{
  key: "30",
  label: uiT("近 30 天")
}, {
  key: "90",
  label: uiT("近 90 天")
}, {
  key: "all",
  label: uiT("全部")
}];
const STATUS_LABEL = () => ({
  completed: uiT("已完成"),
  scheduled: uiT("待上课"),
  cancelled: uiT("已取消"),
  no_show: uiT("缺勤")
});
function Metric({
  label,
  value,
  sub,
  icon: Icon,
  tone = "primary"
}) {
  useUiLanguage();
  const tones = {
    primary: "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300",
    success: "bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-300",
    warning: "bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-300",
    danger: "bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-300"
  };
  return <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <span className={`w-6 h-6 rounded flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>;
}
function toCsv(items) {
  const head = [uiT("日期"), uiT("状态"), uiT("时长(分钟)"), uiT("老师"), uiT("表现"), uiT("作业")];
  const rows = items.map(i => [i.scheduled_at ? new Date(i.scheduled_at).toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai"
  }) : "", STATUS_LABEL()[i.status] || i.status || "", i.duration_min ?? "", i.teacher_name ?? "", i.performance ?? "", i.homework ?? ""]);
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  return [head, ...rows].map(r => r.map(esc).join(",")).join("\n");
}
export function StudentReport({
  studentId,
  feedbackHref
}) {
  useUiLanguage();
  const [range, setRange] = useState("30");
  const {
    from,
    to
  } = schoolPeriod(range);
  const {
    data,
    isLoading,
    error
  } = useQuery({
    queryKey: ["student-report", studentId, range],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const q = qs.toString();
      return (await http(`/students/${studentId}/report${q ? `?${q}` : ""}`)).data;
    },
    enabled: !!studentId
  });
  const m = data?.metrics ?? {};
  const items = data?.items ?? [];
  function exportCsv() {
    const csv = toCsv(items);
    const blob = new Blob([`\ufeff${csv}`], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = uiT("学习报告_{0}.csv", [range === "all" ? uiT("全部") : uiT("近{0}天", [range])]);
    a.click();
    URL.revokeObjectURL(url);
  }
  return <section>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500 dark:text-gray-400" />{" " + uiT("学习报告") + " "}<a href={feedbackHref || `/admin/reports?studentId=${studentId}`} className="ml-1 text-xs font-normal text-primary-700 dark:text-primary-400 hover:underline">{" " + uiT("课后反馈 →") + " "}</a>
        </h2>
        <div className="flex items-center gap-2">
          <Segmented size="sm" value={range} onChange={setRange} items={RANGES()} />
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!items.length}>
            <Download className="w-3.5 h-3.5 mr-1" />{" " + uiT("导出") + " "}</Button>
        </div>
      </div>

      <Card className="p-4">
        {isLoading && <Loading />}
        {error && <div className="text-sm text-danger-600 dark:text-danger-300 ">{" " + uiT("加载失败:") + " "}{error.message}
          </div>}

        {data && <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label={uiT("上课次数")} value={m.completed ?? 0} sub={uiT("计划 {0} 节", [m.planned ?? 0])} icon={CheckCircle2} tone="success" />
              <Metric label={uiT("总课时")} value={`${m.hours ?? 0}h`} icon={Clock} tone="primary" />
              <Metric label={uiT("完课比例")} value={m.attendance_rate == null ? "—" : `${m.attendance_rate}%`} sub={uiT("已完成 / 计划")} icon={TrendingUp} tone={(m.attendance_rate ?? 100) >= 80 ? "success" : "warning"} />
              <Metric label={uiT("缺勤")} value={m.no_show ?? 0} icon={UserX} tone="danger" />
              <Metric label={uiT("请假")} value={m.leave_approved ?? 0} sub={uiT("已批准")} icon={Calendar} tone="warning" />
              <Metric label={uiT("剩余课时")} value={`${m.remaining_hours ?? 0}h`} icon={Clock} tone="primary" />
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              {items.length === 0 ? <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{" " + uiT("该周期内没有课节记录") + " "}</div> : <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-y-auto">
                  {items.slice(0, 30).map(i => <li key={i.id} className="py-2 flex items-center gap-3">
                      <div className="w-16 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        {i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString(uiLocale(), {
                  timeZone: "Asia/Shanghai"
                }) : "—"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          {STATUS_LABEL()[i.status] || i.status}
                          {i.teacher_name && <span className="text-gray-500 dark:text-gray-400 ml-2 text-xs">
                              {i.teacher_name}
                            </span>}
                        </div>
                        {i.performance && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{" " + uiT("表现:") + " "}{i.performance}
                          </div>}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        {i.duration_min ? uiT("{0} 分钟", [i.duration_min]) : ""}
                      </div>
                    </li>)}
                  {items.length > 30 && <li className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">{" " + uiT("仅显示最近 30 条，共") + " "}{items.length}{" " + uiT("条") + " "}</li>}
                </ul>}
            </div>
          </>}
      </Card>
    </section>;
}
