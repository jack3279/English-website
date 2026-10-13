import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Clock, User, AlertTriangle } from "lucide-react";
import { canMoveLesson, lessonAppearance } from "./scheduleInsights.js";
const DAY_LABELS = () => [uiT("周一"), uiT("周二"), uiT("周三"), uiT("周四"), uiT("周五"), uiT("周六"), uiT("周日")];
function isToday(d) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export default function WeekGrid({
  anchor,
  lessons,
  draggable = true,
  onReschedule,
  onLessonClick,
  // 家长视角隐藏学员名（与 MonthGrid 的 hideStudent 同一口径）。
  // ⚠️ 之前只有月视图有这个开关，周视图无条件渲染学员名 → 同一角色在两个视图里
  // 看到的信息量不一致，看起来像权限漏了。
  hideStudent = false,
  warnings = new Map()
}) {
  useUiLanguage();
  const days = Array.from({
    length: 7
  }).map((_, i) => addDays(anchor, i));
  function onDragStart(e, lesson) {
    if (!draggable || !onReschedule || !canMoveLesson(lesson)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", lesson.id);
  }
  function onDragOver(e) {
    if (!draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function onDrop(e, targetDay) {
    if (!draggable) return;
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) return;
    const oldDate = new Date(lesson.scheduled_at);
    // 保持原 hour:minute, 只换 day
    const newDate = new Date(targetDay);
    newDate.setHours(oldDate.getHours(), oldDate.getMinutes(), 0, 0);
    if (newDate.getTime() === oldDate.getTime()) return;
    if (!canMoveLesson(lesson)) return;
    onReschedule?.(lesson, {
      proposedAt: newDate.toISOString()
    });
  }
  const mobileFlex = <div className="flex gap-2 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scroll-px-4 lg:hidden scrollbar-thin">
      {days.map((day, i) => <DayColumn key={i} day={day} index={i} lessons={lessons} isToday={isToday(day)} className="w-[85%] min-w-0 snap-start flex-shrink-0" onDragStart={onDragStart} onDragOver={onDragOver} onDrop={e => onDrop(e, day)} draggable={draggable && !!onReschedule} onLessonClick={onLessonClick} hideStudent={hideStudent} warnings={warnings} />)}
    </div>;
  const desktopGrid = <div className="hidden lg:grid lg:grid-cols-7 lg:gap-2">
      {days.map((day, i) => <DayColumn key={i} day={day} index={i} lessons={lessons} isToday={isToday(day)} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={e => onDrop(e, day)} draggable={draggable && !!onReschedule} onLessonClick={onLessonClick} hideStudent={hideStudent} warnings={warnings} />)}
    </div>;
  return <div className="relative">
      {mobileFlex}
      {desktopGrid}
      <div className="py-2 text-center text-xs text-gray-500 dark:text-gray-400 lg:hidden">{" " + uiT("左右滑动查看其他日期，点击课程查看详情") + " "}</div>
      {draggable && <div className="hidden text-center text-xs text-gray-500 dark:text-gray-400 mt-2 lg:block">{" " + uiT("拖动待上课程后，可确认或修改具体时间") + " "}</div>}
    </div>;
}
function DayColumn({
  day,
  index,
  lessons,
  isToday,
  className = "",
  onDragStart,
  onDragOver,
  onDrop,
  draggable,
  onLessonClick,
  hideStudent = false,
  warnings
}) {
  useUiLanguage();
  const dayLessons = lessons.filter(l => {
    const t = new Date(l.scheduled_at);
    return t.getFullYear() === day.getFullYear() && t.getMonth() === day.getMonth() && t.getDate() === day.getDate();
  });
  return <div className={`bg-white dark:bg-gray-900 border ${isToday ? "border-primary-300 ring-1 ring-primary-200 dark:border-primary-800 " : "border-gray-200 dark:border-gray-800"} rounded-lg p-2 min-h-[200px] flex flex-col ${className}`} onDragOver={onDragOver} onDrop={onDrop}>
      <div className={`flex items-baseline justify-between mb-2 pb-2 border-b ${isToday ? "border-primary-200 dark:border-primary-800 " : "border-gray-100 dark:border-gray-800"}`}>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{DAY_LABELS()[index]}</div>
          <div className={`text-base font-semibold ${isToday ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-gray-100"}`}>
            {day.getMonth() + 1}/{day.getDate()}
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {dayLessons.length > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs ${isToday ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
              {dayLessons.length}
            </span>}
        </div>
      </div>

      {dayLessons.length === 0 ? <div className="flex-1 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 py-4">{" " + uiT("无课") + " "}</div> : <div className="flex-1 space-y-1.5 overflow-y-auto">
          {dayLessons.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).map(l => {
        const time = new Date(l.scheduled_at).toLocaleTimeString(uiLocale(), {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit"
        });
        const tone = lessonAppearance(l);
        const alerts = warnings.get(l.id) || [];
        const conflict = alerts.some(label => label.includes(uiT("时间冲突")));
        const canDrag = draggable && canMoveLesson(l) && !!onDrop;
        return <button type="button" key={l.id} aria-label={`${time} ${hideStudent ? uiT("我") : l.students?.full_name || uiT("学员")} ${l.profiles?.full_name || uiT("老师")} ${tone.label} ${alerts.join("、")}`} title={[tone.label, l.leave_reason, ...alerts].filter(Boolean).join(" · ")} className={`w-full text-left ${tone.className} border rounded-md p-2 text-xs ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${conflict ? "ring-2 ring-danger-500" : ""} hover:shadow-sm transition`} draggable={canDrag} onDragStart={canDrag ? e => onDragStart(e, l) : undefined} onClick={() => onLessonClick?.(l)}>
                  <div className="flex items-center gap-1 font-medium">
                    <Clock className="w-3 h-3" />
                    {time}
                    <span className="opacity-70 font-normal">{l.duration_min || 60}{" " + uiT("分钟")}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-gray-700 dark:text-gray-300">
                    <User className="w-3 h-3" />
                    <span className="font-medium">
                      {hideStudent ? uiT("我") : l.students?.full_name || "?"}
                    </span>
                  </div>
                  {l.profiles?.full_name && <div className="text-gray-500 dark:text-gray-400 text-[10px]">
                      → {l.profiles.full_name}
                    </div>}
                  <div className="mt-1 text-[10px] font-medium">{tone.label}</div>
                  {alerts.length > 0 && <div className={`mt-1 text-[10px] font-semibold ${conflict ? "text-danger-700 dark:text-danger-300" : "text-warning-700 dark:text-warning-300"}`}>
                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                      {alerts.join(" · ")}
                    </div>}
                </button>;
      })}
        </div>}
    </div>;
}
