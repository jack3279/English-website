import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useMemo, useState } from "react";
import { Clock, Users, AlertTriangle } from "lucide-react";
import { assignLanes, canMoveLesson, lessonAppearance } from "./scheduleInsights.js";

/**
 * 学员 × 时间 网格视图 —— 一屏看每个学员当天所有课节,横向比较谁在什么时段。
 *
 * 支持两种模式:
 *   - 模式 day  (默认, weekMode=false): 单日网格, 列 = 学员, 行 = 时间
 *   - 模式 week (weekMode=true): 单选学员时, 列 = 周一~周日, 行 = 时间, 1 列学员
 *       适用: 看某学员本周 (7 天) 的所有课节
 *
 * 与 TeacherWeekGrid 行为一致, 只是 teacher ↔ student.
 *
 * day 模式拖动: 改 scheduled_at + student_id
 * week 模式拖动: 仅改 scheduled_at (学员不变, 跨天/时间)
 *
 * 冲突检测: 同列同行 laneCount > 1 = 数据库遗留冲突 (红色 ring + 警告图标)
 *
 * Props 与 TeacherWeekGrid 一致, 只是 teachers -> students
 */

const ROWS_PER_HOUR = 2;
const ROW_HEIGHT_DEFAULT = 18;
function fmtTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const WEEK_LABEL = () => [uiT("周一"), uiT("周二"), uiT("周三"), uiT("周四"), uiT("周五"), uiT("周六"), uiT("周日")];
export default function StudentWeekGrid({
  lessons = [],
  students = [],
  date,
  weekMode = false,
  rowHeight = ROW_HEIGHT_DEFAULT,
  startHour = 8,
  endHour = 22,
  onLessonClick,
  onReschedule,
  warnings = new Map()
}) {
  useUiLanguage();
  const [dropTarget, setDropTarget] = useState(null); // { colIdx, rowIdx }
  const [draggingId, setDraggingId] = useState(null);
  const totalRows = (endHour - startHour) * ROWS_PER_HOUR;

  // 锚周 (周一 00:00)
  const weekStart = useMemo(() => date ? startOfWeek(date) : null, [date, uiLocale()]);
  const weekEnd = useMemo(() => weekStart ? addDays(weekStart, 7) : null, [weekStart, uiLocale()]);

  // 1. 学员列 (day 模式)
  const studentCols = useMemo(() => {
    if (students.length > 0) {
      return students.map(s => ({
        id: s.id || s.student_id,
        name: s.full_name || s.name || "—"
      }));
    }
    const m = new Map();
    for (const l of lessons) {
      if (!l.student_id) continue;
      if (!m.has(l.student_id)) {
        m.set(l.student_id, {
          id: l.student_id,
          name: l.students?.full_name || "—"
        });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [students, lessons, uiLocale()]);

  // 2. week 模式的列 = 7 天
  const weekCols = useMemo(() => {
    if (!weekMode || !weekStart) return [];
    return Array.from({
      length: 7
    }, (_, i) => {
      const d = addDays(weekStart, i);
      return {
        id: i,
        name: WEEK_LABEL()[i],
        date: d,
        label: `${d.getMonth() + 1}/${d.getDate()}`
      };
    });
  }, [weekMode, weekStart, uiLocale()]);
  const cols = weekMode ? weekCols : studentCols;
  const colCount = Math.max(cols.length, 1);

  // 学员 id 集合 (week 模式过滤用)
  const studentIdSet = useMemo(() => new Set(studentCols.map(s => s.id)), [studentCols, uiLocale()]);

  // 学员列索引 (day 模式)
  const studentColIndex = useMemo(() => {
    const m = new Map();
    studentCols.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [studentCols, uiLocale()]);

  // 3. 时间戳 -> 网格行号 + 同列多课节水平分组
  const positioned = useMemo(() => {
    if (!date) return [];
    const dayStart = new Date(date);
    dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, 0, 0, 0);
    const out = [];
    for (const l of lessons) {
      const t = new Date(l.scheduled_at);
      let colIdx;
      if (weekMode) {
        if (!weekStart || !weekEnd) continue;
        if (t < weekStart || t >= weekEnd) continue;
        if (studentIdSet.size > 0 && !studentIdSet.has(l.student_id)) continue;
        colIdx = (t.getDay() + 6) % 7;
      } else {
        if (t.getFullYear() !== dayStart.getFullYear() || t.getMonth() !== dayStart.getMonth() || t.getDate() !== dayStart.getDate() || t < dayStart || t >= dayEnd) {
          continue;
        }
        colIdx = studentColIndex.get(l.student_id);
        if (colIdx === undefined) continue;
      }
      const startMinOfDay = (t.getHours() - startHour) * 60 + t.getMinutes();
      const startRow = Math.max(0, Math.floor(startMinOfDay / 30));
      const durRows = Math.max(0.5, Number(l.duration_min || 60) / 30);
      out.push({
        lesson: l,
        colIdx,
        startRow,
        durRows
      });
    }
    return assignLanes(out);
  }, [lessons, date, startHour, endHour, weekMode, weekStart, weekEnd, studentIdSet, studentColIndex, uiLocale()]);

  // 冲突检测

  // 拖拽改期，按「是否跨学员」选端点：
  //   - 纯改时间(学员不变): PATCH /lessons/:id（老师可改自己的课）
  //   - 跨学员(day 模式拖到另一学员列): PATCH /schedules/:id（仅 admin）
  const totalHeight = totalRows * rowHeight;

  // 4. 时间轴行号
  const timeRows = useMemo(() => {
    const out = [];
    for (let i = 0; i <= totalRows; i++) {
      const min = startHour * 60 + i * 30;
      const h = Math.floor(min / 60);
      const m = min % 60;
      out.push({
        index: i,
        label: m === 0 ? fmtTime(h, m) : ""
      });
    }
    return out;
  }, [startHour, totalRows, uiLocale()]);

  // 拖拽处理
  function onDragOver(e, colIdx, rowIdx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({
      colIdx,
      rowIdx
    });
  }
  function onDragLeaveGrid() {
    setDropTarget(null);
  }
  function onDrop(e, colIdx, rowIdx) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) return;
    let newDate;
    let studentId;
    if (weekMode) {
      newDate = new Date(weekStart);
      newDate.setDate(newDate.getDate() + colIdx);
      newDate.setHours(startHour, 0, 0, 0);
      newDate.setMinutes(newDate.getMinutes() + rowIdx * 30);
      studentId = undefined;
    } else {
      studentId = studentCols[colIdx]?.id;
      if (!studentId) return;
      newDate = new Date(date);
      newDate.setHours(startHour, 0, 0, 0);
      newDate.setMinutes(newDate.getMinutes() + rowIdx * 30);
    }
    const oldT = new Date(lesson.scheduled_at);
    const sameTime = oldT.getFullYear() === newDate.getFullYear() && oldT.getMonth() === newDate.getMonth() && oldT.getDate() === newDate.getDate() && oldT.getHours() === newDate.getHours() && oldT.getMinutes() === newDate.getMinutes();
    if (sameTime && (studentId === undefined || lesson.student_id === studentId)) {
      setDropTarget(null);
      setDraggingId(null);
      return;
    }
    if (!canMoveLesson(lesson)) return;
    onReschedule?.(lesson, {
      proposedAt: newDate.toISOString(),
      studentId: studentId,
      studentName: studentCols[colIdx]?.name
    });
    setDropTarget(null);
    setDraggingId(null);
  }
  function onLessonDragStart(e, lesson) {
    if (!canMoveLesson(lesson) || !onReschedule) {
      // 已完成 / 已取消 的课节不拖
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", lesson.id);
    setDraggingId(lesson.id);
  }

  // 头部列标签
  const headerCells = weekMode ? weekCols.map(c => <div key={c.id} className="px-1 py-1.5 text-[12px] font-medium text-gray-700 dark:text-gray-200 border-r last:border-r-0 border-gray-100 dark:border-gray-800 text-center" title={`${c.name} (${c.date.toLocaleDateString(uiLocale(), {
    timeZone: "Asia/Shanghai"
  })})`}>
          <div className="truncate">{c.name}</div>
          <div className="text-[10px] font-normal text-gray-500 dark:text-gray-400 truncate">
            {c.label}
          </div>
        </div>) : studentCols.map(s => <div key={s.id} className="px-2 py-1.5 text-[12px] font-medium text-gray-700 dark:text-gray-200 border-r last:border-r-0 border-gray-100 dark:border-gray-800 truncate text-center" title={s.name}>
          {s.name}
        </div>);
  const emptyColText = weekMode ? uiT("本周无课节") : uiT("暂无学员");
  const emptyDayText = weekMode ? uiT("本周该学员暂无课节") : uiT("所选日期无课节");
  const emptyFilterText = weekMode ? uiT("请先选择一位学员") : uiT("当前筛选条件下没有学员");
  return <div className="relative">
      {/* 头部: 列名 (sticky top) */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-20">
        <div className="w-14 shrink-0 border-r border-gray-200 dark:border-gray-700" />
        <div className="flex-1 overflow-x-auto">
          <div className="grid" style={{
          gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`
        }}>
            {cols.length === 0 ? <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                {emptyColText}
              </div> : headerCells}
          </div>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex max-h-[70vh] overflow-auto">
        {/* 时间列 */}
        <div className="w-14 shrink-0 sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" style={{
        minHeight: totalHeight
      }}>
          {timeRows.map(r => <div key={r.index} className="text-[10px] text-gray-500 dark:text-gray-400 px-1 text-right pr-1.5 leading-none flex items-start justify-end" style={{
          height: rowHeight
        }}>
              {r.label}
            </div>)}
        </div>

        {/* 网格主体 */}
        <div className="flex-1 overflow-x-auto relative" style={{
        minHeight: totalHeight
      }}>
          <div className="grid relative" style={{
          gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`,
          minHeight: totalHeight
        }}>
            {/* 背景参考线 */}
            {Array.from({
            length: totalRows
          }).map((_, i) => <div key={`r${i}`} className={`border-t col-start-1 ${i % ROWS_PER_HOUR === 0 ? "border-gray-200 dark:border-gray-700" : "border-gray-100/70 dark:border-gray-800/60"}`} style={{
            gridColumnEnd: colCount + 1,
            height: rowHeight
          }} />)}

            {/* 课节块 */}
            {positioned.map(p => {
            const t = new Date(p.lesson.scheduled_at);
            const startMinOfDay = (t.getHours() - startHour) * 60 + t.getMinutes();
            const top = startMinOfDay / 30 * rowHeight;
            const height = p.durRows * 30 * rowHeight / 30;
            const laneCount = p.laneCount;
            const widthPct = 100 / (colCount * laneCount);
            const leftPct = widthPct * p.slot;
            const appearance = lessonAppearance(p.lesson);
            const tone = appearance.className;
            const isConflict = (warnings.get(p.lesson.id) || []).some(label => label.includes(uiT("时间冲突")));
            const isDragging = draggingId === p.lesson.id;
            const canDrag = canMoveLesson(p.lesson) && !!onReschedule;
            const dateLabel = weekMode ? `${WEEK_LABEL()[(t.getDay() + 6) % 7]} ${t.getMonth() + 1}/${t.getDate()}` : "";
            const titleParts = [appearance.label, ...(warnings.get(p.lesson.id) || []), p.lesson.profiles?.full_name || "", "→", p.lesson.students?.full_name || "", dateLabel, fmtTime(t.getHours(), t.getMinutes()), `${p.lesson.duration_min || 60}m`, isConflict ? uiT("⚠ 冲突") : ""].filter(Boolean);
            return <button type="button" key={p.lesson.id + "-" + p.slot} onClick={() => onLessonClick?.(p.lesson)} draggable={canDrag} onDragStart={e => onLessonDragStart(e, p.lesson)} onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }} className={`absolute border-l-2 rounded-r-md px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden hover:shadow-md transition z-10 ${tone} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-40" : ""} ${isConflict ? "ring-2 ring-danger-500 ring-offset-1 dark:ring-offset-gray-900" : ""}`} style={{
              top: `${top}px`,
              height: `${Math.max(height, rowHeight - 1)}px`,
              left: `calc(${p.colIdx * 100 / colCount}% + ${leftPct}% * 1)`,
              width: `calc(${widthPct}% - 2px)`
            }} title={titleParts.join(" · ")}>
                  <div className="font-semibold truncate flex items-center gap-1">
                    {isConflict && <AlertTriangle className="w-3 h-3 text-danger-600 dark:text-danger-400 shrink-0" />}
                    <span className="truncate">
                      {fmtTime(t.getHours(), t.getMinutes())} ·{" "}
                      {p.lesson.profiles?.full_name || "?"}
                    </span>
                  </div>
                  {height >= rowHeight * 1.4 && <div className="opacity-75 truncate text-[9px]">
                      {p.lesson.students?.full_name || ""}
                    </div>}
                </button>;
          })}

            {/* 拖拽 drop zone */}
            {cols.length > 0 && <div className="absolute inset-0 grid z-0" style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`,
            gridTemplateRows: `repeat(${totalRows}, ${rowHeight}px)`
          }} onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) onDragLeaveGrid();
          }}>
                {Array.from({
              length: totalRows * colCount
            }).map((_, idx) => {
              const colIdx = idx % colCount;
              const rowIdx = Math.floor(idx / colCount);
              const isHover = dropTarget && dropTarget.colIdx === colIdx && dropTarget.rowIdx === rowIdx;
              return <div key={`d${idx}`} onDragOver={e => onDragOver(e, colIdx, rowIdx)} onDrop={e => onDrop(e, colIdx, rowIdx)} className={`border-r border-b border-transparent ${isHover ? "bg-primary-100/60 dark:bg-primary-900/30" : ""}`} />;
            })}
              </div>}

            {/* 空状态 */}
            {cols.length > 0 && positioned.length === 0 && <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-xs text-gray-500 dark:text-gray-400 px-3 py-2 bg-white/80 dark:bg-gray-900/80 rounded-md backdrop-blur-sm">
                  <Clock className="w-4 h-4 mx-auto mb-1 text-gray-300 dark:text-gray-400" />
                  {emptyDayText}
                </div>
              </div>}
          </div>
        </div>
      </div>

      {/* 列表为空时 */}
      {cols.length === 0 && <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
          <Users className="w-4 h-4 mx-auto mb-1 text-gray-300 dark:text-gray-400" />
          {emptyFilterText}
        </div>}

      {/* 底部图例 */}
      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 text-center pt-1 flex items-center justify-center gap-1.5 flex-wrap">
        <span>{uiT("颜色:")}</span>
        <span className="inline-block w-2 h-2 rounded-sm bg-primary-400 align-middle" />{" " + uiT("已排") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-success-400 align-middle" />{" " + uiT("已完成") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-warning-400 align-middle" />{" " + uiT("缺席") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-gray-400 align-middle" />{" " + uiT("取消") + " "}<span className="inline-flex items-center text-danger-600 dark:text-danger-400">
          <AlertTriangle className="w-3 h-3 mr-0.5" />{" " + uiT("冲突") + " "}</span>
        <span className="ml-2 text-gray-500 dark:text-gray-400">
          · {weekMode ? uiT("拖动已排课节改时间/改天") : uiT("拖动已排课节改时间/学员")}
        </span>
      </div>
    </div>;
}
