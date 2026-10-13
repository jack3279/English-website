import { cn } from "../lib/cn.js";

const variants = {
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  secondary:
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800/40 ",
  danger: "bg-danger-600 text-white hover:bg-danger-500",
};
const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({ children, variant = "primary", size = "md", className, ...rest }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
