import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "../components/ui/button.jsx";
import { BrandMark } from "../components/BrandMark.jsx";
import { NavList } from "./Navigation.jsx";
import { useInstitution } from "../features/admin/InstitutionContext.jsx";
function Brand() {
  useUiLanguage();
  const {
    rules
  } = useInstitution();
  return <div className="px-4 py-5">
      <BrandMark inverted subtitle={rules.institutionName || uiT("教学管理")} />
    </div>;
}

// 侧边栏**不再**放通知入口。
// 原来这里有个「通知中心」按钮开 NotificationPanel, 与顶栏铃铛同源同功能 ——
// 两个默认入口指向同一件事, 用户会困惑该点哪个; 而且面板高度是固定的,
// 名叫「中心」却什么都看不全。
// 现在统一收敛到顶栏铃铛: 铃铛管未读数 + 快速预览, 底部「查看全部」跳 /inbox。
export function Sidebar({
  role
}) {
  useUiLanguage();
  return <aside className="brand-panel flex h-full w-[232px] flex-col text-white">
      <Brand />
      <NavList key={role} role={role} />
    </aside>;
}
export function MobileSidebar({
  role,
  open,
  onClose
}) {
  useUiLanguage();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const desktop = window.matchMedia?.("(min-width: 768px)");
    const focusable = () => [...panel.querySelectorAll("a[href], button:not([disabled])")];
    document.body.style.overflow = "hidden";
    focusable()[0]?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    function onResize(event) {
      if (event.matches) closeRef.current?.();
    }
    document.addEventListener("keydown", onKeyDown);
    desktop?.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop?.removeEventListener("change", onResize);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={uiT("导航菜单")}>
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside ref={panelRef} className="brand-panel absolute bottom-0 left-0 top-0 flex w-64 flex-col text-white shadow-modal">
        <div className="flex items-center justify-between pr-2">
          <Brand />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={uiT("关闭菜单")} className="text-white hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <NavList role={role} onClick={onClose} />
      </aside>
    </div>;
}
