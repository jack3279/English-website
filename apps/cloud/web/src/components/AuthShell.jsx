import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import { BrandMark } from "./BrandMark.jsx";
export function AuthShell({
  title,
  subtitle,
  children,
  footer
}) {
  useUiLanguage();
  return <div className="page-canvas flex min-h-dvh items-center justify-center p-4 sm:p-6">
      <section className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white p-6 shadow-card sm:p-8 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-7 flex items-center justify-between gap-3">
          <BrandMark subtitle={uiT("教学管理")} /><LanguageSwitcher />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">{footer}</div>}
      </section>
    </div>;
}
