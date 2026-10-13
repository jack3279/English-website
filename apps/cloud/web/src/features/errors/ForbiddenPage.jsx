import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useSearchParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import ErrorPage from "./ErrorPage.jsx";

/**
 * 403 - 用户已登录但角色无权访问目标页面。
 * RoleGuard 在角色不匹配时跳到这里 (?need=...&mine=...&from=...)。
 */
export default function ForbiddenPage() {
  useUiLanguage();
  const [params] = useSearchParams();
  const need = params.get("need");
  const mine = params.get("mine");
  const description = need && mine ? uiT("该页面仅限「{0}」访问,你当前的身份是「{1}」。如确需访问,请联系机构管理员开通权限。", [need, mine]) : uiT("当前账号角色不允许访问该页面。如确需访问,请联系机构管理员开通权限。");
  return <ErrorPage status={403} icon={ShieldAlert} title={uiT("无权访问此页面")} description={description} accent="warning" />;
}
