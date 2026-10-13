import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * 统一的加载占位。
 *
 * 之前 20 个文件里散着 27 处「加载中…」纯文本（有的是 Card、有的是 div、字号颜色各不相同），
 * 是最扎眼的"廉价感"来源之一 —— 每页都长得不一样，而且纯文字看不出"在动"。
 * 统一成一个细线转圈 + 可选说明文字，全站观感一致。
 */
export function Loading({
  label = uiT("加载中"),
  className
}) {
  useUiLanguage();
  return <div className={cn("flex items-center justify-center gap-2 py-16 text-sm text-gray-500 dark:text-gray-400", className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>;
}

/** 放进卡片里用的版本（保留卡片本身的白底与圆角） */
export function LoadingCard({
  label,
  className
}) {
  useUiLanguage();
  return <div className={cn("rounded-xl bg-white py-20 shadow-card ring-1 ring-gray-900/[0.04] dark:bg-gray-900 dark:ring-white/[0.06]", className)}>
      <Loading label={label} className="py-0" />
    </div>;
}

/** 骨架块：列表/表格这类"形状可预期"的地方用它比转圈更有质感 */
export function Skeleton({
  className
}) {
  useUiLanguage();
  return <div className={cn("animate-pulse rounded-md bg-gray-100 dark:bg-gray-800", className)} />;
}

/** 若干行骨架，用于列表/表格加载 */
export function SkeletonRows({
  rows = 5,
  className
}) {
  useUiLanguage();
  return <div className={cn("space-y-3", className)}>
      {Array.from({
      length: rows
    }).map((_, i) => <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>)}
    </div>;
}
