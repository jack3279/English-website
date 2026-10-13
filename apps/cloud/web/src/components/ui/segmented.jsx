import { cn } from "../../lib/utils.js";

/**
 * 分段控件（筛选 / 周期切换 / Tab）。
 *
 * 之前全站有 5 套写法：边框按钮组（选中填实心主色）、圆角胶囊、rounded-full 胶囊……
 * 每种颜色、高度、圆角都不一样，一眼就看得出"没统一"。
 * 统一成 iOS 那种「浅灰底 + 白色滑块」：底色几乎不抢戏，选中态靠白色块 + 极轻阴影表达，
 * 比"选中就填一整块主色"克制得多 —— 主色留给真正的 CTA。
 *
 * items: [{ key, label, icon? }]
 */
export function Segmented({ value, onChange, items, className, size = "md" }) {
  const h = size === "sm" ? "h-8 text-xs" : "h-9 text-sm";
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-gray-100/80 p-0.5 dark:bg-gray-800/60",
        className,
      )}
    >
      {items.map((it) => {
        const active = value === it.key;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={active}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 font-medium transition-colors duration-150",
              h,
              active
                ? "bg-white text-gray-900 shadow-xs dark:bg-gray-700 dark:text-gray-50"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
