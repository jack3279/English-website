import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { AlertTriangle, ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
export default function ScheduleChecks({
  insights,
  limits,
  onLimitsChange,
  onLessonClick,
  loading,
  error,
  onRetry,
  incomplete
}) {
  useUiLanguage();
  const conflictCount = new Set(insights.conflicts.flatMap(pair => [pair.first.id, pair.second.id])).size;
  return <details className="group rounded-xl border border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 text-primary-700 dark:text-primary-300 " />
        <span className="font-semibold">{uiT("排课检查")}</span>
        <span className={conflictCount ? "text-danger-700 dark:text-danger-300 " : insights.warnings.length ? "text-warning-700 dark:text-warning-300 " : "text-gray-500 dark:text-gray-400 "}>
          {loading ? uiT("检查中…") : error ? uiT("暂时无法检查") : uiT("{0} 节冲突 · {1} 项负荷提醒", [conflictCount, insights.warnings.length])}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 text-gray-500 group-open:rotate-180 dark:text-gray-400 " />
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4 dark:border-gray-800">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[["dailyHours", uiT("每日课时上限（小时）"), 1, 24, 0.5], ["weeklyHours", uiT("每周课时上限（小时）"), 1, 168, 0.5], ["consecutiveLessons", uiT("连堂提醒（连续节数）"), 2, 12, 1], ["breakMinutes", uiT("建议休息间隔（分钟）"), 1, 60, 1]].map(([key, label, min, max, step]) => <div key={key}>
              <Label htmlFor={`load-${key}`} className="mb-1.5 block text-xs">
                {label}
              </Label>
              <Input id={`load-${key}`} type="number" value={limits[key]} min={min} max={max} step={step} disabled={!onLimitsChange} onChange={event => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= min && value <= max && (step !== 1 || Number.isInteger(value))) onLimitsChange?.({
              ...limits,
              [key]: value
            });
          }} />
            </div>)}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 ">{" " + uiT("阈值由机构统一设置。按北京时间、当前显示范围的待上及已完成课程估算，取消、缺席和已批准请假不计入负荷。短间隔连堂指课间休息不足")}{" "}
          {limits.breakMinutes}{" " + uiT("分钟。") + " "}</p>
        {incomplete && <p role="alert" className="text-sm text-warning-700 dark:text-warning-300 ">{" " + uiT("当前范围课节较多，检查结果可能不完整，请缩小日期范围核对。") + " "}</p>}
        {error ? <div role="alert" className="text-sm text-danger-700 dark:text-danger-300 ">{" " + uiT("课表加载失败，无法判断冲突。") + " "}<Button variant="outline" size="sm" className="ml-2" onClick={onRetry}>{" " + uiT("重试") + " "}</Button>
          </div> : loading ? null : <>
            {insights.conflicts.length > 0 && <ul className="space-y-2">
                {insights.conflicts.map(pair => <li key={`${pair.kind}:${pair.first.id}:${pair.second.id}`} className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-200">
                    <AlertTriangle className="mr-1 inline h-4 w-4" />
                    {pair.kind === "teacher" ? uiT("教师时间重叠") : uiT("学员时间重叠")}：
                    {pair.first.profiles?.full_name || uiT("老师")} ·{" "}
                    {pair.first.students?.full_name || uiT("学员")} /{" "}
                    {pair.second.students?.full_name || uiT("学员")}
                    <Button variant="ghost" size="sm" onClick={() => onLessonClick(pair.first)}>{" " + uiT("查看第一节") + " "}</Button>
                    <Button variant="ghost" size="sm" onClick={() => onLessonClick(pair.second)}>{" " + uiT("查看第二节") + " "}</Button>
                  </li>)}
              </ul>}
            {insights.warnings.length > 0 && <ul className="space-y-2">
                {insights.warnings.map((warning, index) => <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
                    <span className="flex-1">
                      {warning.teacherName} · {warning.period} ·{" "}
                      {warning.type === "invalid" ? uiT("课节时长异常，请核对") : warning.type === "consecutive" ? uiT("{0} 节短间隔连堂", [warning.count]) : uiT("{0} {1} 小时，超过 {2} 小时", [warning.type === "day" ? uiT("当日") : uiT("该周"), warning.hours, warning.limit])}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => onLessonClick({
              id: warning.lessonIds[0]
            })}>{" " + uiT("查看课程") + " "}</Button>
                  </li>)}
              </ul>}
            {!insights.conflicts.length && !insights.warnings.length && !incomplete && <p className="text-sm text-gray-500 dark:text-gray-400 ">{" " + uiT("当前已加载课节未发现时间重叠或超出提醒阈值的安排。") + " "}</p>}
          </>}
      </div>
    </details>;
}
