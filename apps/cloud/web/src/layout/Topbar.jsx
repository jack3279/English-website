import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, AlertTriangle } from "lucide-react";
import { useAuth } from "../features/auth/useAuth.js";
import { Button } from "../components/Button.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { Dialog } from "../components/ui/dialog.jsx";
import { NotificationBell } from "../features/notifications/NotificationBell.jsx";
import GlobalSearch from "../features/GlobalSearch.jsx";

export function Topbar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  function doLogout() {
    setShowLogoutConfirm(false);
    logout();
    navigate("/login");
  }

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 flex items-center justify-between gap-4">
      <GlobalSearch />
      <div className="flex items-center gap-4">
        <NotificationBell />
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Avatar name={user?.full_name || user?.email} size="sm" />
          <span>{user?.full_name || user?.email}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowLogoutConfirm(true)}
          aria-label="登出"
        >
          <LogOut className="w-4 h-4 mr-1" /> 登出
        </Button>
      </div>

      {showLogoutConfirm && (
        <Dialog
          open
          onClose={() => setShowLogoutConfirm(false)}
          title={
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-300 " />
              <span>确认登出?</span>
            </div>
          }
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              登出后本设备将清除登录态,下次打开需要重新输入密码。
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              如果只是想换账号,先在右上角确认下当前是不是自己的账号,避免误登。
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>
              取消
            </Button>
            <Button onClick={doLogout} className="bg-warning-600 hover:bg-warning-700 text-white">
              <LogOut className="w-4 h-4 mr-1" /> 确认登出
            </Button>
          </div>
        </Dialog>
      )}
    </header>
  );
}
