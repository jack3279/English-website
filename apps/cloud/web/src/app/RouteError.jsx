import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { reportClientError } from "../lib/errors.js";
export default function RouteError() {
  useUiLanguage();
  const error = useRouteError();
  useEffect(() => {
    reportClientError(error, {
      source: "router"
    });
  }, [error]);
  return <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-card dark:bg-gray-900" role="alert">
        <h1 className="text-lg font-semibold">{uiT("这一页暂时无法打开")}</h1>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{" " + uiT("请重新加载页面；如果问题持续，请联系管理员。") + " "}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-lg bg-primary-600 px-5 py-3 text-white">{" " + uiT("重新加载") + " "}</button>
        <a href="/" className="mt-4 block text-sm text-primary-600">{" " + uiT("返回首页") + " "}</a>
      </section>
    </div>;
}
