import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { AlertOctagon } from "lucide-react";
import ErrorPage from "./ErrorPage.jsx";

/**
 * 500 - 服务器内部错误兜底页。
 * 实际接入通常在 fetch 拦截器或 React Error Boundary;这里作为可直接打开的页面,
 * 也用于网关/Cloudflare 5xx 场景的回退目标。
 */
export default function ServerErrorPage() {
  useUiLanguage();
  return <ErrorPage status={500} icon={AlertOctagon} title={uiT("服务器开了小差")} description={uiT("服务暂时不可用或内部错误。已记录此次请求,请稍后重试或联系管理员。")} accent="destructive" />;
}
