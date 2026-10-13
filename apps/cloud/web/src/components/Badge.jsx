import { cn } from "../lib/cn.js";

const tones = {
  success: "bg-success-100 text-success-600 dark:bg-success-900/40 dark:text-success-300 ",
  warning: "bg-warning-100 text-warning-600 dark:bg-warning-900/40 dark:text-warning-300 ",
  danger: "bg-danger-100 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300 ",
  primary: "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ",
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 ",
};

export function Badge({ tone = "primary", children, className }) {
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
