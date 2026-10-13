import { cn } from "../lib/cn.js";

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {Icon && <Icon className="w-12 h-12 text-gray-300 mb-4" />}
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 ">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400 ">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
