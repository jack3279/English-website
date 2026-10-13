import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useMemo, useState } from "react";
import { Clock, User, AlertTriangle } from "lucide-react";
import { assignLanes, canMoveLesson, lessonAppearance } from "./scheduleInsights.js";

/**
 * 老师 × 时间 网格视图 —— 类似 Outlook / 钉钉日历的工作时间表。
 *
 * 支持两种模式:
 *   - 模式 day  (默认, weekMode=false): 单日网格, 列 = 老师, 行 = 时间
 *       适用: 全部/多选老师 chip, 一屏看几个老师某一天的课节
 *   - 模式 week (weekMode=true): 单选老师时, 列 = 周一~周日, 行 = 时间, 1 列老师
 *       适用: 看某老师本周 (7 天) 的所有课节
 *
 * day 模式:
 *   - 行 = 半小时 (默认 08:00 ~ 22:00 = 14h × 2 = 28 行)
 *   - 列 = 筛选后要展示的老师 (默认本周有课的所有老师)
 *   - 左上角 sticky 时间轴 + 顶部 sticky 老师表头 (滚动时跟随)
 *   - 课节块: absolute 定位, top 由 scheduled_at 算, height 由 duration_min 算
 *   - 同一老师同一时段多课节: 水平并列 (避免垂直堆叠遮挡)
 *   - 冲突可视化: 已有重叠 (数据库遗留) 给红色边框 + AlertTriangle 图标
 *
 * week 模式:
 *   - 行 = 半小时 (08:00 ~ 22:00)
 *   - 列 = 周一~周日 (7 列)
 *   - 过滤条件: 该老师 + 该周 (date 所在周, 周一~周日)
 *   - 拖拽: 改 scheduled_at (colIdx 决定周几, rowIdx 决定时间), teacher_id 不变
 *
 * Props:
 *   - lessons: SchedulePage 已加载的数组
 *   - teachers: Teacher 选项数组
 *   - date: Date 对象, 决定 day 模式下的展示日期 / week 模式下的"锚周"
 *   - weekMode: boolean (默认 false)
 *   - rowHeight: 每行 px
 *   - startHour / endHour: 展示时段
 *   - onLessonClick: 点课节 -> 详情
 *   - queryKeyToInvalidate: 拖拽成功后失效的 query key (默认 ['schedule', 'schedules'])
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
export default function TeacherWeekGrid({
  lessons = [],
  teachers = [],
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

  // 锚周 (周一 00:00) —— week 模式用
  const weekStart = useMemo(() => date ? startOfWeek(date) : null, [date, uiLocale()]);
  const weekEnd = useMemo(() => weekStart ? addDays(weekStart, 7) : null, [weekStart, uiLocale()]);

  // 1. 老师列 (day 模式)
  const teacherCols = useMemo(() => {
    if (teachers.length > 0) {
      return teachers.map(t => ({
        id: t.profile_id || t.id,
        name: t.full_name || t.name || "—"
      }));
    }
    const m = new Map();
    for (const l of lessons) {
      if (!l.teacher_id) continue;
      if (!m.has(l.teacher_id)) {
        m.set(l.teacher_id, {
          id: l.teacher_id,
          name: l.profiles?.full_name || "—"
        });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [teachers, lessons, uiLocale()]);

  // 2. week 模式的列 = 7 天 (周一~周日)
  const weekCols = useMemo(() => {
    if (!weekMode || !weekStart) return [];
    return Array.from({
      length: 7
    }, (_, i) => {
      const d = addDays(weekStart, i);
      return {
        id: i,
        // weekday index 0~6
        name: WEEK_LABEL()[i],
        date: d,
        label: `${d.getMonth() + 1}/${d.getDate()}`
      };
    });
  }, [weekMode, weekStart, uiLocale()]);

  // 当前激活的 cols + colCount
  const cols = weekMode ? weekCols : teacherCols;
  const colCount = Math.max(cols.length, 1);

  // 老师 id 集合 (week 模式下过滤 lessons 用)
  const teacherIdSet = useMemo(() => new Set(teacherCols.map(t => t.id)), [teacherCols, uiLocale()]);

  // 老师列索引 (day 模式)
  const teacherColIndex = useMemo(() => {
    const m = new Map();
    teacherCols.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [teacherCols, uiLocale()]);

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
        // week 模式: 过滤该周 + 该老师集合
        if (!weekStart || !weekEnd) continue;
        if (t < weekStart || t >= weekEnd) continue;
        if (teacherIdSet.size > 0 && !teacherIdSet.has(l.teacher_id)) continue;
        colIdx = (t.getDay() + 6) % 7; // 周一=0, ..., 周日=6
      } else {
        // day 模式: 过滤单日 + 老师映射
        if (t.getFullYear() !== dayStart.getFullYear() || t.getMonth() !== dayStart.getMonth() || t.getDate() !== dayStart.getDate() || t < dayStart || t >= dayEnd) {
          continue;
        }
        colIdx = teacherColIndex.get(l.teacher_id);
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
  }, [lessons, date, startHour, endHour, weekMode, weekStart, weekEnd, teacherIdSet, teacherColIndex, uiLocale()]);

  // 冲突检测: 同列同行 laneCount > 1 = 数据库遗留冲突

  // 拖拽改期 mutation，按「是否跨老师」选端点：
  //   - 纯改时间(老师不变, 含 week 模式 / day 模式同列): PATCH /lessons/:id（老师可改自己的课）
  //   - 跨老师(day 模式拖到另一老师列): PATCH /schedules/:id（仅 admin）
  const totalHeight = totalRows * rowHeight;

  // 4. 时间轴行号 (HH:MM 标签只在整点显示)
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

  // 拖拽处理: drop 时根据 (colIdx, rowIdx) 算新 scheduled_at
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
    let teacherId;
    if (weekMode) {
      // week 模式: colIdx = weekday, rowIdx = time 槽; 老师不变
      newDate = new Date(weekStart);
      newDate.setDate(newDate.getDate() + colIdx);
      newDate.setHours(startHour, 0, 0, 0);
      newDate.setMinutes(newDate.getMinutes() + rowIdx * 30);
      teacherId = undefined; // 后端不更新
    } else {
      // day 模式: colIdx = 老师列
      teacherId = teacherCols[colIdx]?.id;
      if (!teacherId) return;
      newDate = new Date(date);
      newDate.setHours(startHour, 0, 0, 0);
      newDate.setMinutes(newDate.getMinutes() + rowIdx * 30);
    }
    const oldT = new Date(lesson.scheduled_at);
    const sameTime = oldT.getFullYear() === newDate.getFullYear() && oldT.getMonth() === newDate.getMonth() && oldT.getDate() === newDate.getDate() && oldT.getHours() === newDate.getHours() && oldT.getMinutes() === newDate.getMinutes();
    if (sameTime && (teacherId === undefined || lesson.teacher_id === teacherId)) {
      setDropTarget(null);
      setDraggingId(null);
      return;
    }
    if (!canMoveLesson(lesson)) return;
    onReschedule?.(lesson, {
      proposedAt: newDate.toISOString(),
      teacherId: teacherId,
      teacherName: teacherCols[colIdx]?.name
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
        </div>) : teacherCols.map(t => <div key={t.id} className="px-2 py-1.5 text-[12px] font-medium text-gray-700 dark:text-gray-200 border-r last:border-r-0 border-gray-100 dark:border-gray-800 truncate text-center" title={t.name}>
          {t.name}
        </div>);

  // 空状态文案
  const emptyColText = weekMode ? uiT("本周无课节") : uiT("暂无老师");
  const emptyDayText = weekMode ? uiT("本周该老师暂无课节") : uiT("所选日期无课节");
  const emptyFilterText = weekMode ? uiT("请先选择一位老师") : uiT("当前筛选条件下没有老师");
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

      {/* 主体: 时间列 (sticky left) + 网格 */}
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

        {/* 网格主体 (横向滚动) */}
        <div className="flex-1 overflow-x-auto relative" style={{
        minHeight: totalHeight
      }}>
          <div className="grid relative" style={{
          gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`,
          minHeight: totalHeight
        }}>
            {/* 背景参考线 + 时间行 (横跨所有列的整点/半点参考线) */}
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
            const height = p.durRows * 30 * rowHeight / 30; // = p.durRows * rowHeight
            const laneCount = p.laneCount;
            const widthPct = 100 / (colCount * laneCount);
            const leftPct = widthPct * p.slot;
            const appearance = lessonAppearance(p.lesson);
            const tone = appearance.className;
            const isConflict = (warnings.get(p.lesson.id) || []).some(label => label.includes(uiT("时间冲突")));
            const isDragging = draggingId === p.lesson.id;
            const canDrag = canMoveLesson(p.lesson) && !!onReschedule;

            // title 加日期 (week 模式多课节必显示日期)
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
                      {weekMode ? `${fmtTime(t.getHours(), t.getMinutes())} ` : ""}
                      {fmtTime(t.getHours(), t.getMinutes())} ·{" "}
                      {p.lesson.students?.full_name || "?"}
                    </span>
                  </div>
                  {height >= rowHeight * 1.4 && <div className="opacity-75 truncate text-[9px]">
                      {p.lesson.profiles?.full_name || ""}
                    </div>}
                </button>;
          })}

            {/* 拖拽 drop zone —— 覆盖整个网格, 接收 drop 事件 */}
            {cols.length > 0 && <div className="absolute inset-0 grid z-0" style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`,
            gridTemplateRows: `repeat(${totalRows}, ${rowHeight}px)`
          }} onDragLeave={e => {
            // 仅当真的离开整个网格时清掉 (relatedTarget 在父元素外面)
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

      {/* 列表为空时,底部友好提示 */}
      {cols.length === 0 && <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
          <User className="w-4 h-4 mx-auto mb-1 text-gray-300 dark:text-gray-400" />
          {emptyFilterText}
        </div>}

      {/* 底部图例 */}
      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 text-center pt-1 flex items-center justify-center gap-1.5 flex-wrap">
        <span>{uiT("颜色:")}</span>
        <span className="inline-block w-2 h-2 rounded-sm bg-primary-400 align-middle" />{" " + uiT("已排") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-success-400 align-middle" />{" " + uiT("已完成") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-warning-400 align-middle" />{" " + uiT("缺席") + " "}<span className="inline-block w-2 h-2 rounded-sm bg-gray-400 align-middle" />{" " + uiT("取消") + " "}<span className="inline-flex items-center text-danger-600 dark:text-danger-400">
          <AlertTriangle className="w-3 h-3 mr-0.5" />{" " + uiT("冲突") + " "}</span>
        <span className="ml-2 text-gray-500 dark:text-gray-400">
          · {weekMode ? uiT("拖动已排课节改时间/改天") : uiT("拖动已排课节改时间/老师")}
        </span>
      </div>
    </div>;
}
