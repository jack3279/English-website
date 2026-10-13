import { Search } from "lucide-react";
import ErrorPage from "./errors/ErrorPage.jsx";

/**
 * 404 - 路径不存在。
 * 视觉/交互完全复用通用 ErrorPage,文案按 404 调优。
 */
export default function NotFoundPage() {
  return (
    <ErrorPage
      status={404}
      icon={Search}
      title="页面不存在"
      description="访问的页面不存在或已被移动。请检查 URL 是否正确。"
      accent="primary"
    />
  );
}
