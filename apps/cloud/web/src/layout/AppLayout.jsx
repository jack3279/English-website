import {DataScopeBanner} from "./DataScopeBanner.jsx";
import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { MobileBottomNav } from "./MobileBottomNav.jsx";
import { Sidebar, MobileSidebar } from "./Sidebar.jsx";
import { AppNavigationContext } from "./AppNavigationContext.jsx";
import { useAuth } from "../features/auth/useAuth.js";

/**
 * 需要登录的页面的统一外壳: 左侧持久导航 + 内容区滚动容器。
 *
 * 为什么不放顶栏: 每个页面本来就有自己的 PageHeader(标题 + 返回 + 主题/通知/用户),
 * 再加一条顶栏就是「两条横条叠着」, 白白吃掉 56px。通知铃铛与用户菜单并入 PageHeader。
 *
 * 内容区**不加 max-width / padding** —— 宽度与内边距交给各页面自己的 <main>。
 * （AppShell 之前在这里又套了一层 max-w-6xl + p-6, 和页面自己的容器叠加,
 *   导致顶栏与内容左右边缘对不齐, 短页面还会多出一屏空白。）
 */
export function AppLayout() {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const role = user?.role || "parent";
  const [open, setOpen] = useState(false);
  const {
    pathname
  } = useLocation();
  const mainRef = useRef(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);
  return <AppNavigationContext.Provider value={{
    openMenu: () => setOpen(true),
    menuOpen: open
  }}>
      <div className={`page-canvas flex h-dvh overflow-hidden ${["admin", "teacher", "parent"].includes(role) ? "role-mobile" : ""}`}>
        <div className="hidden md:block">
          <Sidebar role={role} />
        </div>
        <MobileSidebar role={role} open={open} onClose={() => setOpen(false)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main ref={mainRef} className="app-scroll min-h-0 flex-1 overflow-y-auto">
            <DataScopeBanner user={user} />
            {user?.password_change_recommended && <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-warning-50 px-4 py-2 text-sm text-warning-800 dark:bg-warning-900/25 dark:text-warning-300 ">
                <span>{uiT("当前账号仍使用测试初始密码，请先修改密码。")}</span>
                <Link to="/settings" className="font-medium underline">{" " + uiT("前往账号设置") + " "}</Link>
              </div>}
            <Outlet />
          </main>
          <MobileBottomNav role={role} />
        </div>
      </div>
    </AppNavigationContext.Provider>;
}
