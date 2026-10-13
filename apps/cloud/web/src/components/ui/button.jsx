import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils.js";

const variants = {
  default:
    "bg-primary-700 text-white shadow-xs hover:bg-primary-800 hover:shadow-card active:bg-primary-900 dark:bg-primary-500 dark:hover:bg-primary-400 dark:text-gray-950",
  destructive:
    "bg-danger-600 text-white shadow-xs hover:bg-danger-700 hover:shadow-card active:bg-danger-800 dark:bg-danger-500 dark:hover:bg-danger-400 dark:text-gray-950",
  outline:
    "border border-gray-300 bg-white text-gray-700 shadow-xs hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:hover:border-gray-600 dark:hover:text-gray-100 ",
  secondary:
    "bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700",
  ghost:
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-100 ",
  link: "text-primary-700 underline-offset-4 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300",
};
const sizes = {
  default: "h-9 px-3.5",
  sm: "h-8 px-3 text-xs",
  lg: "h-11 px-6 text-base",
  icon: "h-9 w-9",
};

export const Button = forwardRef(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          // active:translate-y-px 让点击有"按下去"的反馈; 焦点环用 40% 透明的主色,
          // 比实心 ring 温和(实心环在浅色界面上像多了一圈边框)。
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0 dark:focus-visible:ring-offset-gray-900",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
