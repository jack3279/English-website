import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar, MobileSidebar } from "./Sidebar.jsx";
import { Topbar } from "./Topbar.jsx";
import { Button } from "../components/ui/button.jsx";
import { useAuth } from "../features/auth/useAuth.js";

export function AppShell({ children }) {
  const { user } = useAuth();
  const role = user?.role || "parent";
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-800/40 ">
      {/* 桌面端 sidebar */}
      <div className="hidden md:block">
        <Sidebar role={role} />
      </div>
      {/* 移动端 drawer */}
      <MobileSidebar role={role} open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* 移动端顶部加汉堡按钮 */}
        <div className="md:hidden bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 h-12 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="text-sm font-semibold text-primary-700 dark:text-primary-300 ">
            17say.org
          </div>
        </div>
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
