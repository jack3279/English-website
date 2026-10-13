import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { X } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
function toYMD(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

/**
 * 老师/学员视图 通用筛选条 —— 日期 + chips 多选
 *
 * Props:
 *   - day + setDay: 当前展示日期 (weekMode=true 时仍用作"锚周"基准)
 *   - items: 候选数组 [{ id, name }]
 *   - selectedIds + setSelectedIds: 已选 id 数组 (空 = 全部)
 *   - label: "老师" 或 "学员"
 *   - weekMode: boolean — 单选 1 个 chip 时为 true, 日期筛选被替换为 "本周" 提示
 *     (该 chip 的本周所有课节会被展示, 不受 day 选择影响)
 */
export default function AxisFilter({
  day,
  setDay,
  items,
  selectedIds,
  setSelectedIds,
  label,
  weekMode = false
}) {
  useUiLanguage();
  const ws = day ? startOfWeek(day) : null;
  const we = ws ? addDays(ws, 6) : null;
  const weekRangeLabel = ws && we ? `${ws.getMonth() + 1}/${ws.getDate()} ~ ${we.getMonth() + 1}/${we.getDate()}` : "";
  return <div className="flex items-center gap-2 flex-wrap">
      {/* 日期 (weekMode=true 时改为只读"本周"提示) */}
      <div className="flex items-center gap-1.5 text-xs">
        {weekMode ? <>
            <span className="text-gray-500 dark:text-gray-400">{uiT("本周:")}</span>
            <span className="h-8 inline-flex items-center px-2.5 rounded-md border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-medium">
              {weekRangeLabel}
            </span>
          </> : <>
            <span className="text-gray-500 dark:text-gray-400">{uiT("日期:")}</span>
            <input type="date" value={toYMD(day)} onChange={e => {
          const v = e.target.value;
          if (!v) return;
          const d = new Date(v);
          d.setHours(0, 0, 0, 0);
          setDay(d);
        }} className="h-8 px-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <Button variant="ghost" size="sm" onClick={() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          setDay(d);
        }} className="text-xs">{" " + uiT("今天") + " "}</Button>
          </>}
      </div>

      {/* chips 多选 */}
      {items.length > 0 && <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}:</span>
          <button type="button" onClick={() => setSelectedIds([])} className={`h-7 px-2.5 rounded-full text-[11px] font-medium border transition ${selectedIds.length === 0 ? "bg-primary-600 text-white border-primary-600" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-primary-400"}`}>{" " + uiT("全部 (")}{items.length})
          </button>
          {items.map(it => {
        const active = selectedIds.length > 0 && selectedIds.includes(it.id);
        return <button type="button" key={it.id} onClick={() => {
          setSelectedIds(prev => {
            if (prev.length === 0) return [it.id];
            if (prev.includes(it.id)) {
              const next = prev.filter(id => id !== it.id);
              return next.length === 0 ? [] : next;
            }
            return [...prev, it.id];
          });
        }} className={`h-7 px-2.5 rounded-full text-[11px] font-medium border transition ${active ? "bg-primary-600 text-white border-primary-600" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-primary-400"}`} title={it.name}>
                {it.name}
              </button>;
      })}
          {selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])} className="h-7 px-2 rounded-full text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label={uiT("清除筛选")}>
              <X className="w-3 h-3 inline mr-0.5" />{" " + uiT("清除") + " "}</button>}
        </div>}
    </div>;
}
