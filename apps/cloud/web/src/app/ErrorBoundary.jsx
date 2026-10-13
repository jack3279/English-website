import React from "react";
import { reportClientError } from "../lib/errors.js";

/**
 * 全局错误边界。
 *
 * 原来这里是一段内联样式的裸红字 + 直接把 err.message 摊在页面上 ——
 * 既是"最丑的一屏"，也把内部细节暴露给了使用者。
 * 改成: 一句人话 + 重新加载 + 默认收起的「技术细节」，同时照旧上报。
 */
export default class ErrorBoundary extends React.Component {
  state = { err: null, showDetail: false };

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    reportClientError(err, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.err) return this.props.children;

    const msg = String(this.state.err?.message || this.state.err || "未知错误");
    // 发版瞬间还开着的旧页面, 去取已被替换掉的 chunk 会 404 —— 这其实不是"页面出错",
    // 而是"有新版本了"。文案要分清, 用户才知道按一下就好。
    const isStaleChunk = /dynamically imported module|Importing a module script failed/i.test(msg);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-pop ring-1 ring-gray-900/[0.04] dark:bg-gray-900 dark:ring-white/[0.06]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isStaleChunk ? "系统刚更新过" : "这一页出了点问题"}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {isStaleChunk
              ? "页面用的还是旧版本，重新加载一下就好，你的数据不受影响。"
              : "先重新加载试试；如果一直这样，请把下方技术细节发给管理员。"}
          </p>
          <button
            onClick={() => location.reload()}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary-600 px-5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-primary-700"
          >
            重新加载
          </button>

          <button
            type="button"
            onClick={() => this.setState({ showDetail: !this.state.showDetail })}
            className="mt-4 block w-full text-center text-xs text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
          >
            {this.state.showDetail ? "收起技术细节" : "查看技术细节"}
          </button>
          {this.state.showDetail && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-gray-50 p-3 text-left text-[11px] leading-relaxed text-gray-500 dark:bg-gray-950 dark:text-gray-400">
              {msg}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
