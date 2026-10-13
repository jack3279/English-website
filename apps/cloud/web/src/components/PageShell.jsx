import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { PageHeader } from "./PageHeader.jsx";
import { cn } from "../lib/utils.js";
export function PageShell({
  children,
  className,
  contentClassName,
  ...headerProps
}) {
  useUiLanguage();
  return <div className={cn("min-h-full", className)}>
      <PageHeader {...headerProps} />
      <div className={cn("page-body space-y-6", contentClassName)}>{children}</div>
    </div>;
}
