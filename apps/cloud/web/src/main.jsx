import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";
import "./styles/base.css";
import "./styles/tailwind.css";
import { recoverChunkOnce } from "./lib/chunkRecovery.js";

// 发版时的「旧页面取不到新 chunk」问题。
//
// 单页应用每次发布都会重新生成带哈希的 chunk 文件名。此时还开着的旧页面（或缓存了旧
// index.html 的浏览器）去加载某个 lazy 路由会 404 —— 页面直接白屏，用户只会以为"系统坏了"。
// 线上实测遇到过: Failed to fetch dynamically imported module: .../AdminDashboardPage-xxxx.js
//
// Vite 遇到这种情况会派发 `vite:preloadError`，这里接住并**自动刷新一次**去拿新的入口。
// 同一构建只自动恢复一次，网络持续异常时交给错误页，避免反复刷新。
function reloadOnceForNewVersion() {
  recoverChunkOnce(import.meta.url);
}

window.addEventListener("vite:preloadError", reloadOnceForNewVersion);

const root = createRoot(document.getElementById("root"));
root.render(<App />);
