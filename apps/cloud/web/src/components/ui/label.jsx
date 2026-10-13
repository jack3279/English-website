import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Label = forwardRef(({ className, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium text-gray-700 leading-none dark:text-gray-300", className)}
    {...props}
  >
    {children}
  </label>
));
Label.displayName = "Label";
