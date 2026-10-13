import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { schoolDay, schoolInput } from "./scheduleInsights.js";
import { useMemo } from "react";
import { Clock, MapPin, Video, AlertTriangle } from "lucide-react";
import { lessonAppearance } from "./scheduleInsights.js";

/**
 * 手机端课表 —— 按天分组的纵向列表（`md:hidden` 生效，桌面端走 *WeekGrid）。
 *
 * 为什么不用网格：WeekGrid 是 `repeat(N, minmax(72px, 1fr))` 的横向比较视图，
 * 学员/外教一多，窄屏扣掉时间列后只剩 200 多px，列会被压到读不出字。
 * 网格的价值是「横向对比谁在什么时段」，这件事在手机上本来就不成立。
 * 所以这里不复用网格的思路，改成适合窄屏的信息结构：按天分段 → 按时��排 → 卡片承载详情。
 *
 * 时间一律按本地解释（与后端 Asia/Shanghai 存 ISO 的口径一致）。
 */

const WEEK_LABEL = () => [uiT("周日"), uiT("周一"), uiT("周二"), uiT("周三"), uiT("周四"), uiT("周五"), uiT("周六")];

// 时段分组：上午 / 下午 / 晚上。边界按国内英语培训的真实作息划，
// 早上 8 点开课、下午 18 点后算晚上。
const BANDS = () => [{
  key: "morning",
  label: uiT("上午"),
  from: 0,
  to: 12
}, {
  key: "afternoon",
  label: uiT("下午"),
  from: 12,
  to: 18
}, {
  key: "evening",
  label: uiT("晚上"),
  from: 18,
  to: 24
}];
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function endTime(lesson) {
  return fmtTime(new Date(new Date(lesson.scheduled_at).getTime() + Number(lesson.duration_min || 60) * 60000));
}
function dayKey(date) {
  return schoolDay(date);
}
export default function MobileScheduleList({
  lessons = [],
  students = [],
  teachers = [],
  hideStudent = false,
  weekMode = false,
  onLessonClick,
  warnings = new Map()
}) {
  useUiLanguage();
  const studentName = useMemo(() => {
    const m = new Map();
    for (const s of students) m.set(s.id || s.student_id, s.full_name || s.name || "—");
    return m;
  }, [students, uiLocale()]);
  const teacherName = useMemo(() => {
    const m = new Map();
    for (const t of teachers) {
      // 注意：课表里 lessons.teacher_id 存的是 profile_id，不是 teachers.id。
      // 这里两种键都登记一次，避免下游只传了其中一个导致显示「—」。
      const id = t.profile_id || t.id;
      if (id) m.set(id, t.full_name || t.name || "—");
      if (t.id) m.set(t.id, t.full_name || t.name || "—");
    }
    return m;
  }, [teachers, uiLocale()]);

  // 按天分组 -> 组内再按时段分组
  const groups = useMemo(() => {
    const byDay = new Map();
    for (const l of lessons) {
      if (!l.scheduled_at) continue;
      const d = new Date(l.scheduled_at);
      const k = dayKey(d);
      if (!byDay.has(k)) byDay.set(k, {
        date: d,
        items: []
      });
      byDay.get(k).items.push(l);
    }
    const days = [...byDay.values()].sort((a, b) => a.date - b.date);
    for (const day of days) day.items.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    return days.map(day => {
      const bands = BANDS().map(b => ({
        ...b,
        items: day.items.filter(l => {
          const h = Number(schoolInput(l.scheduled_at).slice(11, 13));
          return h >= b.from && h < b.to;
        })
      })).filter(b => b.items.length > 0);
      return {
        ...day,
        bands
      };
    });
  }, [lessons, uiLocale()]);
  if (groups.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400 ">
        {weekMode ? uiT("本周暂无课节") : uiT("所选日期无课节")}
      </div>;
  }
  return <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {groups.map(day => {
      const isToday = dayKey(day.date) === dayKey(new Date());
      const count = day.items.length;
      return <section key={day.date.toISOString()}>
            <div className="flex items-baseline gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 sticky top-0 z-10">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {isToday ? uiT("今天") : day.date.toLocaleDateString(uiLocale(), {
              timeZone: "Asia/Shanghai",
              weekday: "short"
            })}
              </span>
              <span className="text-xs text-gray-500 tabular-nums dark:text-gray-400 ">
                {day.date.toLocaleDateString(uiLocale(), {
              timeZone: "Asia/Shanghai",
              month: "numeric",
              day: "numeric"
            })}
              </span>
              <span className="ml-auto text-xs text-gray-500 tabular-nums dark:text-gray-400 ">
                {count}{" " + uiT("节") + " "}</span>
            </div>

            {day.bands.map(band => <div key={band.key} className="px-4 py-2">
                <div className="text-[11px] text-gray-500 mb-1.5 dark:text-gray-400 ">
                  {band.label}
                </div>
                <div className="space-y-1.5">
                  {band.items.map(l => {
              const app = lessonAppearance(l);
              const warn = warnings.get(l.id);
              return <button key={l.id} type="button" onClick={() => onLessonClick?.(l)} className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 tabular-nums shrink-0">
                            {fmtTime(l.scheduled_at)}
                            <span className="text-gray-300 dark:text-gray-400 mx-0.5">–</span>
                            {endTime(l)}
                          </span>
                          {warn && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning-500" />}
                          <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${app.className}`}>
                            {app.label}
                          </span>
                        </div>

                        <div className="mt-1.5 space-y-1">
                          {!hideStudent && <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                              <span className="text-gray-500 dark:text-gray-400 ">{uiT("学员")}</span>
                              <span className="truncate">
                                {studentName.get(l.student_id) || l.students?.full_name || "—"}
                              </span>
                            </div>}
                          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                            <span className="text-gray-500 dark:text-gray-400 ">{uiT("外教")}</span>
                            <span className="truncate">
                              {teacherName.get(l.teacher_id) || uiT("未分配")}
                            </span>
                          </div>
                        </div>

                        {(l.meeting_url || l.location) && <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 ">
                            {l.meeting_url ? <>
                                <Video className="h-3 w-3 shrink-0" />
                                <span className="truncate">{uiT("腾讯会议")}</span>
                              </> : <>
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">{l.location}</span>
                              </>}
                          </div>}
                      </button>;
            })}
                </div>
              </div>)}
          </section>;
    })}
    </div>;
}
