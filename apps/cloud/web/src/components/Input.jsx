import { cn } from "../lib/cn.js";

export function Input({ label, error, className, ...rest }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 ">
          {label}
        </label>
      )}
      <input
        className={cn(
          "w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 ",
          error && "border-danger-500",
          className,
        )}
        {...rest}
      />
      {error && <div className="text-sm text-danger-600 dark:text-danger-300 ">{error}</div>}
    </div>
  );
}
