import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Input = forwardRef(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      // 焦点态: 边框转主色 + 4px 的 10% 主色光晕。原来用实心 ring-2 + border-transparent,
      // 看起来像"多套了一圈边框"。
      "flex h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-base sm:h-9 sm:text-sm text-gray-900 shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-gray-500 hover:border-gray-300 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:hover:border-gray-600 dark:focus:border-primary-500 dark:disabled:bg-gray-800/40 ",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
