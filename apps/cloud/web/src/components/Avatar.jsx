import { cn } from "../lib/cn.js";

export function Avatar({ name, size = "md", className }) {
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-12 h-12 text-base" };
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold dark:bg-primary-900/40 dark:text-primary-300 ",
        sizes[size],
        className,
      )}
    >
      {initial}
    </div>
  );
}
