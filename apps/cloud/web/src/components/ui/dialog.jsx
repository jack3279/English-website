import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";
const activeDialogs = [];
let originalOverflow = "";
let originalFocus = null;
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
  // 嵌套弹层（如“课节详情 → 点名”）需要更高层级，否则上层遮罩会挡住内层按钮点击。
  layer = 0
}) {
  useUiLanguage();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const token = {};
    const previousFocus = document.activeElement;
    if (!activeDialogs.length) {
      originalOverflow = document.body.style.overflow;
      originalFocus = previousFocus;
    }
    activeDialogs.push(token);
    panelRef.current?.focus();
    const focusable = () => [...panelRef.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')];
    const h = event => {
      if (activeDialogs[activeDialogs.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
      }
      if (event.key === "Tab") {
        const list = focusable(),
          first = list[0],
          last = list[list.length - 1];
        if (!list.length) {
          event.preventDefault();
          panelRef.current?.focus();
        } else if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement) || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      const top = activeDialogs[activeDialogs.length - 1] === token;
      activeDialogs.splice(activeDialogs.indexOf(token), 1);
      if (!activeDialogs.length) {
        document.body.style.overflow = originalOverflow;
        if (originalFocus?.isConnected) originalFocus.focus();
        originalFocus = null;
      } else if (top && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl"
  };
  // 嵌套层级：用 tailwind 配置里定义的 z-index 类（确保被 JIT 编译）。
  const zClass = ["z-modal", "z-modal2", "z-modal3", "z-modal4"][layer] || "z-modal4";
  // Portal 到 body：嵌套弹窗才不会被外层弹层的 stacking context 限制，
  // 否则上层全屏遮罩会拦截内层按钮的点击。
  return createPortal(<div className={cn("fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm", zClass)} onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : uiT("操作窗口")} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} className={cn("bg-white rounded-2xl shadow-modal w-full mx-4 my-8 max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100", sizes[size], className)} onClick={e => e.stopPropagation()}>
        {(title || description) && <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h2>}
              {description && <p id={descriptionId} className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {description}
                </p>}
            </div>
            <button type="button" onClick={onClose} aria-label={uiT("关闭")} className="shrink-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 rounded-md p-1.5 -mt-1 -mr-1 transition-colors dark:text-gray-400 ">
              <X className="w-4 h-4" />
            </button>
          </div>}
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-4 sm:px-6 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 flex flex-wrap justify-end gap-2">
            {footer}
          </div>}
      </div>
    </div>, document.body);
}
