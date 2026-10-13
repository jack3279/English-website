import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
// shadcn-style Toast 系统 (无依赖, 简单实现)
// 使用:  import { toast } from '../../components/ui/toast.jsx';
//         toast.success('学员创建成功');
//         toast.error('保存失败: ' + err.message);
//         toast.warning('请检查输入');
//         toast.info('已发送 3 条通知');
import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
const ToastContext = createContext({});
let _id = 0;
const nextId = () => ++_id;
const TONE_STYLE = () => ({
  success: {
    bar: "bg-success-500",
    icon: CheckCircle2,
    iconTone: "text-success-500",
    label: uiT("成功")
  },
  error: {
    bar: "bg-danger-600",
    icon: AlertCircle,
    iconTone: "text-danger-500",
    label: uiT("错误")
  },
  warning: {
    bar: "bg-warning-500",
    icon: AlertTriangle,
    iconTone: "text-warning-500",
    label: uiT("警告")
  },
  info: {
    bar: "bg-primary-500",
    icon: Info,
    iconTone: "text-primary-500",
    label: uiT("提示")
  }
});
function ToastItem({
  t,
  onClose
}) {
  useUiLanguage();
  const meta = TONE_STYLE()[t.tone] || TONE_STYLE().info;
  const Icon = meta.icon;
  return <div role="status" aria-live="polite" className="pointer-events-auto flex items-start gap-3 w-80 max-w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-pop overflow-hidden animate-in slide-in-from-top-2">
      <div className={`w-1 self-stretch ${meta.bar}`} />
      <div className="flex items-start gap-2 p-3 flex-1">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.iconTone}`} />
        <div className="flex-1 min-w-0">
          {t.title && <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{uiT(t.title)}</div>}
          {t.description && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-words">
              {uiT(t.description)}
            </div>}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 dark:text-gray-400 " aria-label={uiT("关闭")}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>;
}
export function Toaster() {
  useUiLanguage();
  const ctx = useContext(ToastContext);
  if (!ctx?.toasts) return null;
  return createPortal(<div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
      {ctx.toasts.map(t => <ToastItem key={t.id} t={t} onClose={() => ctx.dismiss(t.id)} />)}
    </div>, document.body);
}
export function ToastProvider({
  children
}) {
  useUiLanguage();
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback(id => {
    setToasts(cur => cur.filter(t => t.id !== id));
  }, [uiLocale()]);
  const show = useCallback((tone, opts) => {
    const id = nextId();
    const t = {
      id,
      tone,
      title: opts.title,
      description: opts.description,
      duration: opts.duration ?? 4000
    };
    setToasts(cur => [...cur, t].slice(-5)); // 最多 5 个
    if (t.duration > 0) {
      setTimeout(() => dismiss(id), t.duration);
    }
    return id;
  }, [dismiss, uiLocale()]);
  const api = {
    toasts,
    dismiss,
    success: (description, title) => show("success", {
      title,
      description
    }),
    error: (description, title) => show("error", {
      title: title || uiT("操作失败"),
      description
    }),
    warning: (description, title) => show("warning", {
      title,
      description
    }),
    info: (description, title) => show("info", {
      title,
      description
    })
  };
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 没有 Provider 时, 用 console 兜底 (避免 null ref crash)
    return {
      success: (...args) => console.log("[toast]", ...args),
      error: (...args) => console.error("[toast]", ...args),
      warning: (...args) => console.warn("[toast]", ...args),
      info: (...args) => console.info("[toast]", ...args)
    };
  }
  return ctx;
}
