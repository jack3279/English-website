import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Select = forwardRef(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      // 与 Input 保持同一套焦点态, 否则表单里两个控件"手感"不一致
      "flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-gray-300 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600 dark:disabled:bg-gray-800/40 ",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
