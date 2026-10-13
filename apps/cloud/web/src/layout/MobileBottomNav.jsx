import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, CalendarDays, MessageSquare, User, ListChecks } from "lucide-react";
import { useUnreadCount } from "../features/notifications/useNotifications.js";
export function MobileBottomNav({
  role
}) {
  useUiLanguage();
  const {
    data: unread = 0
  } = useUnreadCount({
    enabled: role === "teacher" || role === "parent"
  });
  if (!["admin", "teacher", "parent"].includes(role)) return null;
  const items = [{
    to: role === "admin" ? "/admin" : role === "teacher" ? "/teacher/today" : "/parent",
    label: role === "parent" ? uiT("孩子") : uiT("工作台"),
    icon: LayoutDashboard
  }, {
    to: "/schedule",
    label: uiT("课表"),
    icon: CalendarDays
  }, role === "admin" ? {
    to: "/admin/operations",
    label: uiT("待办"),
    icon: ListChecks
  } : {
    to: "/inbox",
    label: uiT("消息"),
    icon: MessageSquare
  }, {
    to: "/settings",
    label: uiT("我的"),
    icon: User
  }];
  return <nav aria-label={uiT("手机主导航")} className="mobile-bottom-nav md:hidden">
      {items.map(({
      to,
      label,
      icon: Icon
    }) => <NavLink key={to} to={to} end className={({
      isActive
    }) => `mobile-tab ${isActive ? "is-active" : ""}`}>
          <span className="relative">
            <Icon aria-hidden="true" className="h-5 w-5" />
            {to === "/inbox" && unread > 0 && <span aria-label={uiT("{0}条未读通知", [unread])} className="absolute -right-3 -top-2 min-w-4 rounded-full bg-danger-600 px-1 text-center text-[10px] leading-4 text-white">
                {unread > 99 ? "99+" : unread}
              </span>}
          </span>
          <span>{label}</span>
        </NavLink>)}
    </nav>;
}
