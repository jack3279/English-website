import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { cn } from "../../lib/utils.js";
import { useState } from "react";
import { Dialog } from "../../components/ui/dialog.jsx";
import { canMoveLesson, lessonAppearance } from "./scheduleInsights.js";
const HEADERS = () => [uiT("周一"), uiT("周二"), uiT("周三"), uiT("周四"), uiT("周五"), uiT("周六"), uiT("周日")];
function hm(iso) {
  return new Date(iso).toLocaleTimeString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

// 周一为一周起点
function startOfWeekMon(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

// 计算覆盖整月的网格：月初所在周周一 → 月末所在周周日
function buildCells(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const gridStart = startOfWeekMon(first);
  const gridEnd = startOfWeekMon(last);
  gridEnd.setDate(gridEnd.getDate() + 7); // 周日末
  const cells = [];
  for (let t = new Date(gridStart); t < gridEnd; t.setDate(t.getDate() + 1)) {
    cells.push(new Date(t));
  }
  return cells;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 月视图：整月日历网格，每格堆叠当天课节精简条，点击开详情。
 * props: anchor(月内任一天), lessons, onLessonClick, hideStudent(家长视角)
 */
export default function MonthGrid({
  anchor,
  lessons,
  onLessonClick,
  hideStudent = false,
  warnings = new Map(),
  draggable = false,
  onReschedule
}) {
  useUiLanguage();
  const [expandedDay, setExpandedDay] = useState(null);
  const cells = buildCells(anchor);
  const month = anchor.getMonth();
  const now = new Date();
  return <div className="select-none">
      {/* 表头 */}
      <div className="grid grid-cols-7 mb-1">
        {HEADERS().map((h, i) => <div key={h} className={cn("text-center text-xs py-1", i >= 5 ? "text-gray-500 dark:text-gray-400 " : "text-gray-500 dark:text-gray-400")}>
            {h}
          </div>)}
      </div>

      {/* 网格（按周分行）。gap-px + 底色画网格线，所以外框不要可见边框，用 ring。*/}
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden shadow-card ring-1 ring-gray-900/[0.04] dark:ring-white/[0.06]">
        {cells.map((d, i) => {
        const inMonth = d.getMonth() === month;
        const today = isSameDay(d, now);
        const dayLessons = lessons.filter(l => isSameDay(new Date(l.scheduled_at), d)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        return <div key={i} onDragOver={event => {
          if (draggable && onReschedule) event.preventDefault();
        }} onDrop={event => {
          if (!draggable || !onReschedule) return;
          event.preventDefault();
          const lesson = lessons.find(row => row.id === event.dataTransfer.getData("text/plain"));
          if (!lesson || !canMoveLesson(lesson)) return;
          const old = new Date(lesson.scheduled_at),
            proposed = new Date(d);
          proposed.setHours(old.getHours(), old.getMinutes(), 0, 0);
          if (proposed.getTime() !== old.getTime()) onReschedule(lesson, {
            proposedAt: proposed.toISOString()
          });
        }} className={cn("min-h-[88px] sm:min-h-[104px] p-1 flex flex-col bg-white dark:bg-gray-900", !inMonth && "bg-gray-50/70 dark:bg-gray-950")}>
              <div className="flex justify-end mb-1">
                <button type="button" aria-label={uiT("{0}月{1}日，{2}节课", [d.getMonth() + 1, d.getDate(), dayLessons.length])} onClick={() => setExpandedDay(d)} className={cn("text-[11px] leading-7 w-7 text-center rounded-full hover:ring-1 hover:ring-primary-300", today && "bg-primary-600 text-white", !today && inMonth ? "text-gray-700 dark:text-gray-300" : "text-gray-300 dark:text-gray-400")}>
                  {d.getDate()}
                </button>
              </div>

              <div className="flex-1 space-y-0.5 overflow-hidden">
                {dayLessons.slice(0, 3).map(l => {
              const appearance = lessonAppearance(l);
              const alerts = warnings.get(l.id) || [];
              const extra = hideStudent ? l.profiles?.full_name || uiT("外教") : l.students?.full_name || uiT("学员");
              const conflict = alerts.some(label => label.includes(uiT("时间冲突")));
              return <button key={l.id} data-lesson-id={l.id} draggable={draggable && !!onReschedule && canMoveLesson(l)} onDragStart={event => {
                if (!draggable || !onReschedule || !canMoveLesson(l)) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", l.id);
              }} onClick={() => onLessonClick?.(l)} className={cn("w-full border-l-2 text-left text-[10px] sm:text-[11px] leading-tight rounded px-1 py-1 hover:shadow-sm", appearance.className, conflict && "ring-1 ring-danger-500")} title={`${hm(l.scheduled_at)} ${extra} · ${l.profiles?.full_name || ""} · ${appearance.label} ${alerts.join("、")}`} aria-label={`${hm(l.scheduled_at)} ${extra} ${appearance.label} ${alerts.join("、")}`}>
                      <span className="block truncate font-medium">
                        {hm(l.scheduled_at)}{" "}
                        <span className="block truncate sm:inline">{extra}</span>
                      </span>
                      <span className="block truncate text-[9px]">
                        {conflict ? uiT("⚠ 时间冲突") : appearance.label}
                        {!conflict && alerts.length > 0 ? " · ⚠" : ""}
                      </span>
                    </button>;
            })}
                {dayLessons.length > 3 && <button type="button" onClick={() => setExpandedDay(d)} className="w-full py-1 text-left text-[10px] text-primary-700 dark:text-primary-300 ">{" " + uiT("另有") + " "}{dayLessons.length - 3}{" " + uiT("节…") + " "}</button>}
              </div>
            </div>;
      })}
      </div>
      {expandedDay && <Dialog open title={uiT("{0}月{1}日的课程", [expandedDay.getMonth() + 1, expandedDay.getDate()])} onClose={() => setExpandedDay(null)}>
          <div className="space-y-2">
            {lessons.filter(lesson => isSameDay(new Date(lesson.scheduled_at), expandedDay)).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)).map(lesson => {
          const appearance = lessonAppearance(lesson),
            alerts = warnings.get(lesson.id) || [];
          return <button key={lesson.id} type="button" onClick={() => {
            setExpandedDay(null);
            onLessonClick?.(lesson);
          }} className={cn("w-full rounded-lg border p-3 text-left text-sm", appearance.className)}>
                    <span className="font-medium">
                      {hm(lesson.scheduled_at)} ·{" "}
                      {hideStudent ? uiT("我") : lesson.students?.full_name || uiT("学员")} ·{" "}
                      {lesson.profiles?.full_name || uiT("外教")}
                    </span>
                    <span className="mt-1 block text-xs">
                      {appearance.label} · {lesson.duration_min || 60}{" " + uiT("分钟") + " "}{alerts.join(" · ")}
                    </span>
                  </button>;
        })}
            {!lessons.some(lesson => isSameDay(new Date(lesson.scheduled_at), expandedDay)) && <p className="text-sm text-gray-500 dark:text-gray-400 ">{" " + uiT("当天没有符合当前筛选条件的课程。") + " "}</p>}
          </div>
        </Dialog>}
    </div>;
}
