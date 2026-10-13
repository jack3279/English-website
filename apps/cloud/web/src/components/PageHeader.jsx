import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import AdminQuickSearch from "../features/admin/AdminQuickSearch.jsx";
import { useAuth } from "../features/auth/useAuth.js";
import { Link } from "react-router-dom";
import { ChevronLeft, Menu } from "lucide-react";
import { useContext } from "react";
import { AppNavigationContext } from "../layout/AppNavigationContext.jsx";
import { cn } from "../lib/utils.js";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { UserMenu } from "./UserMenu.jsx";
import { NotificationBell } from "../features/notifications/NotificationBell.jsx";

/**
 * 全站共用顶栏。左右内边距与 .page-body 相同，标题和下面的内容左缘对齐。
 */
export function PageHeader({
  back = false,
  backLabel = uiT("返回"),
  title,
  icon: Icon,
  subtitle,
  actions,
  className
}) {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const navigation = useContext(AppNavigationContext);
  return <header className={cn("app-page-header sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-gray-800 dark:bg-gray-950/90", className)}>
      <div className="page-frame flex min-h-16 flex-wrap items-center justify-between gap-x-2 gap-y-2 py-2.5 sm:gap-x-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          {navigation && <button type="button" onClick={navigation.openMenu} aria-label={uiT("打开菜单")} aria-expanded={navigation.menuOpen} aria-haspopup="dialog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-gray-800">
              <Menu className="h-5 w-5" />
            </button>}
          {back && <Link to={back} aria-label={backLabel} className="flex shrink-0 items-center gap-0.5 rounded-lg py-1 pl-1 pr-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-200">
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{backLabel}</span>
            </Link>}
          {Icon && <span className={cn("h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-200", navigation ? "hidden md:flex" : "flex")}>
              <Icon className="h-4 w-4" />
            </span>}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-gray-100">
              {title}
            </h1>
            {subtitle && <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-gray-400">
                {subtitle}
              </div>}
          </div>
        </div>
        {actions && <div className="order-2 w-full min-w-0 overflow-x-auto pb-1 lg:order-1 lg:w-auto lg:shrink-0 lg:overflow-visible lg:pb-0">
            {actions}
          </div>}
        <div className="order-1 flex shrink-0 items-center gap-1 lg:order-2">
          {user?.role === "admin" && <AdminQuickSearch />}
          <LanguageSwitcher />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>;
}
