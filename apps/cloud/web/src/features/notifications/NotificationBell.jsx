import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useUnreadCount } from "./useNotifications.js";
import { NotificationPanel } from "./NotificationPanel.jsx";

// 顶栏铃铛：只负责「显示未读数 + 打开面板」，面板本体在 NotificationPanel。
// ⚠️ 这里用useUnreadCount 而不是 useNotifications —— 铃铛常驻顶栏，
// 每次渲染都拉50 条通知正文只为显示一个小数字，既费子请求又没意义。
// 正文只在面板真正打开时才由 NotificationPanel 去取。
export function NotificationBell() {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const {
    data: unread = 0
  } = useUnreadCount();
  useEffect(() => {
    if (!open) return undefined;
    const onClick = e => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  return <div className="relative" ref={boxRef}>
      <button type="button" aria-label={uiT("通知")} onClick={() => setOpen(v => !v)} className="relative p-2 rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
        <Bell className="w-5 h-5" />
        {unread > 0 &&
      // 同 Sidebar: 圆点尺寸走 inline style, 不用 min-w-[16px] —— 本项目
      // Tailwind 产物里不生成任意值(min-w-[...]) 类, 写了等于没写。
      <span style={{
        minWidth: 16,
        height: 16,
        lineHeight: "16px"
      }} className="absolute -top-0.5 -right-0.5 rounded-full bg-danger-600 px-1 text-center text-[11px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>}
      </button>

      {open && <div className="fixed left-4 right-4 top-16 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2">
          <NotificationPanel enabled onNavigate={() => setOpen(false)} />
        </div>}
    </div>;
}
