import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme.js";
import { Button } from "./ui/button.jsx";
export function ThemeToggle() {
  useUiLanguage();
  const {
    isDark,
    toggle
  } = useTheme();
  return <Button variant="ghost" size="icon" onClick={toggle} aria-label={isDark ? uiT("切换到浅色") : uiT("切换到深色")}>
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>;
}
