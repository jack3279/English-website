import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { cn } from "../lib/utils.js";
const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-sm"
};
export function BrandMark({
  size = "md",
  inverted = false,
  showWordmark = true,
  subtitle,
  className
}) {
  useUiLanguage();
  return <div className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("flex shrink-0 items-center justify-center rounded-xl font-semibold text-white", inverted ? "bg-white/15 ring-1 ring-white/20" : "bg-gradient-to-br from-primary-400 to-primary-700 shadow-xs", SIZES[size])}>
        17
      </span>
      {showWordmark && <div className="min-w-0">
          <div className={cn("truncate text-sm font-semibold tracking-tight", inverted ? "text-white" : "text-gray-900 dark:text-gray-100")}>
            17say.org
          </div>
          {subtitle && <div className={cn("truncate text-[11px] leading-tight", inverted ? "text-white/50" : "text-gray-500 dark:text-gray-400")}>
              {subtitle}
            </div>}
        </div>}
    </div>;
}
