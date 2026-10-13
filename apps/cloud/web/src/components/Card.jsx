import { cn } from "../lib/cn.js";

export function Card({ children, className, ...rest }) {
  return (
    <div
      className={cn(
        "bg-white rounded-lg border border-gray-200 p-6 shadow-sm dark:bg-gray-900 dark:border-gray-800 ",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
