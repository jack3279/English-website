import { useSyncExternalStore } from "react";
import catalog from "./en.json";
const listeners = new Set();
let language = "zh",
  identity = null,
  role = null;
const preferenceKey = (id) => `teacher_ui_language_v1:${id}`;
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function notify() {
  if (typeof document !== "undefined")
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  for (const listener of listeners) listener();
}
export function configureUiUser(user) {
  identity = user?.id || null;
  role = user?.role || null;
  const saved =
    role === "teacher"
      ? read(preferenceKey(identity))
      : !role
        ? read("public_ui_language_v1")
        : null;
  const next =
    role === "teacher"
      ? saved === "zh"
        ? "zh"
        : "en"
      : role
        ? "zh"
        : saved === "en"
          ? "en"
          : saved === "zh"
            ? "zh"
            : typeof navigator !== "undefined" &&
                !navigator.language?.toLowerCase().startsWith("zh")
              ? "en"
              : "zh";
  if (next !== language) {
    language = next;
    notify();
  } else if (typeof document !== "undefined")
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
}
export function setUiLanguage(next) {
  if (!["en", "zh"].includes(next) || (role && role !== "teacher")) return;
  try {
    localStorage.setItem(
      role === "teacher" ? preferenceKey(identity) : "public_ui_language_v1",
      next,
    );
  } catch {}
  if (next !== language) {
    language = next;
    notify();
  }
}
export const getUiLanguage = () => language;
export const uiLocale = () => (language === "en" ? "en-US" : "zh-CN");
export function useUiLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getUiLanguage,
    () => "zh",
  );
}
export function uiT(value, args = []) {
  if (typeof value !== "string") return value;
  let output = language === "en" ? (catalog[value] ?? value) : value;
  if (args.length)
    output = output.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? ""));
  return output;
}
export function uiError(value) {
  if (language !== "en" || typeof value !== "string") return value;
  const deadline = value.match(/^请假最晚须在上课前 (\d+) 分钟提交/);
  if (deadline) return `Leave must be requested at least ${deadline[1]} minutes before class. The deadline has passed; non-attendance is recorded as absence, with settlement confirmed by the administrator.`;
  const known = uiT(value);
  if (known !== value || !/[\u3400-\u9fff]/.test(value)) return known;
  return "The request could not be completed. Please try again or contact the school.";
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (role && role !== "teacher") return;
    if (
      event.key === (role === "teacher" ? preferenceKey(identity) : "public_ui_language_v1") &&
      ["en", "zh"].includes(event.newValue)
    ) {
      language = event.newValue;
      notify();
    }
  });
