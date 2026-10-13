import { Card } from "./Card.jsx";
import { cn } from "../lib/cn.js";

const tones = {
  primary: "text-primary-700 dark:text-primary-300 ",
  success: "text-success-600 dark:text-success-300 ",
  warning: "text-warning-600 dark:text-warning-300 ",
  danger: "text-danger-600 dark:text-danger-300 ",
};

export function StatCard({ title, value, icon: Icon, tone = "primary", className }) {
  return (
    <Card className={cn("flex items-center justify-between", className)}>
      <div>
        <div className="text-sm text-gray-500 dark:text-gray-400 ">{title}</div>
        <div className={cn("text-3xl font-bold mt-1", tones[tone])}>{value}</div>
      </div>
      {Icon && <Icon className="w-10 h-10 text-gray-300" />}
    </Card>
  );
}
