import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "v2_theme";
const DARK = "dark";
const LIGHT = "light";

function getInitial() {
  if (typeof window === "undefined") return LIGHT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === DARK || stored === LIGHT) return stored;
  } catch {
    /* localStorage 不可用(隐私模式)时按默认主题走 */
  }
  // Respect OS preference on first visit
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return DARK;
  return LIGHT;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === DARK) root.classList.add(DARK);
  else root.classList.remove(DARK);
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitial);

  useEffect(() => {
    const sync = (event) => {
      const next = event.type === "storage" ? event.newValue : event.detail;
      if (event.type === "storage" && event.key !== STORAGE_KEY) return;
      if (next === DARK || next === LIGHT) setTheme(next);
    };
    window.addEventListener("theme:changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("theme:changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage 不可用(隐私模式)时按默认主题走 */
    }
    window.dispatchEvent(new CustomEvent("theme:changed", { detail: theme }));
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === DARK ? LIGHT : DARK));
  }, []);

  return { theme, setTheme, toggle, isDark: theme === DARK };
}
