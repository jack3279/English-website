import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, User, Settings, ShieldCheck, Wallet } from "lucide-react";
import { useAuth } from "../features/auth/useAuth.js";
const ROLE_LABEL = () => ({
  admin: uiT("机构管理员"),
  teacher: uiT("老师"),
  parent: uiT("家长")
});

/**
 * 顶栏右侧的用户菜单（头像 → 下拉: 身份 / 登出）。
 *
 * 之前全站只有「总览」页有登出按钮（而且那个按钮是页面自己写的），
 * 老师/家长在别的页面根本退不出去。放进 PageHeader 后每一页都有。
 */
export function UserMenu() {
  useUiLanguage();
  const {
    user,
    logout
  } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = e => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const name = user?.full_name || user?.email || uiT("未登录");
  const initial = (name || "?").charAt(0).toUpperCase();
  return <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-label={uiT("账号")} aria-expanded={open} className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 dark:bg-primary-900/50 dark:text-primary-200">
          {initial}
        </span>
        <span className="hidden max-w-[8rem] truncate text-sm text-gray-700 sm:block dark:text-gray-300">
          {name}
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-gray-500 sm:block dark:text-gray-400 " />
      </button>

      {open && <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-pop dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {name}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <User className="h-3 w-3" />
              {ROLE_LABEL()[user?.role] || user?.role || "—"}
              {user?.branch_name ? ` · ${user.branch_name}` : ""}
            </div>
          </div>
          {user?.role === "teacher" && <Link to="/teacher/payroll" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <Wallet className="h-4 w-4" />{" " + uiT("我的课酬") + " "}</Link>}
          <Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            <Settings className="h-4 w-4" />{" " + uiT("账号设置") + " "}</Link>
          <Link to="/admin/sessions" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            <ShieldCheck className="h-4 w-4" />{" " + uiT("登录设备") + " "}</Link>
          <button type="button" onClick={() => {
        logout();
        navigate("/login");
      }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
            <LogOut className="h-4 w-4" />{" " + uiT("退出登录") + " "}</button>
        </div>}
    </div>;
}
