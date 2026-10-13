import { cn } from "../../lib/utils.js";

const variants = {
  default: "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  secondary: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  destructive: "bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300",
  success: "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300",
  warning: "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300",
  outline: "text-gray-700 border-gray-300 dark:text-gray-300 dark:border-gray-700 border",
};

export function Badge({ className, variant = "default", ...props }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
