import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useNavigate } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { useAuth } from "../auth/useAuth.js";

/**
 * 通用错误页基础组件。404 / 403 / 500 都基于它,
 * 仅 icon / 数字 / 标题 / 副标题 / 颜色不同 —— 视觉一致,文案按状态调整。
 *
 * Props:
 *   status: 数字 (404 | 403 | 500 ...)
 *   icon: lucide 图标组件
 *   title: 主标题 (例如 "页面不存在")
 *   description: 副标题 (解释为什么)
 *   accent: 'primary' | 'warning' | 'destructive' —— 决定圆圈背景 + 文字色
 *   homePath: 点击「回到首页」跳哪里;默认 /admin (登录态用户的总览)
 */
export default function ErrorPage({
  status,
  icon: Icon,
  title,
  description,
  accent = "primary",
  homePath
}) {
  useUiLanguage();
  const navigate = useNavigate();
  const {
    user
  } = useAuth();
  const home = homePath || (user?.role === "parent" ? "/parent" : user?.role === "teacher" ? "/teacher/today" : user?.role === "admin" ? "/admin" : "/login");
  const accentClass = {
    primary: "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400",
    warning: "bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400",
    destructive: "bg-danger-50 text-danger-600 dark:bg-danger-900/25 dark:text-danger-300"
  }[accent] || "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400";
  return <div className="page-canvas flex min-h-screen items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className={`inline-flex w-20 h-20 rounded-full items-center justify-center mb-6 ${accentClass}`}>
          <Icon className="w-10 h-10" />
        </div>
        <div className="text-7xl font-bold text-gray-900 dark:text-gray-100 mb-2">{status}</div>
        <h1 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">{title}</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">{description}</div>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" />{" " + uiT("返回上页") + " "}</Button>
          <Button onClick={() => navigate(home)}>
            <Home className="w-4 h-4 mr-1" />{" " + uiT("回到首页") + " "}</Button>
        </div>
      </div>
    </div>;
}
