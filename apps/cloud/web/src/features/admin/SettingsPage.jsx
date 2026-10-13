import LanguageSwitcher from "../../i18n/LanguageSwitcher.jsx";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { User, Building2, Phone, Mail, KeyRound } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import ChangePasswordForm from "../auth/ChangePasswordForm.jsx";
import { Button } from "../../components/ui/button.jsx";
import { ThemeToggle } from "../../components/ThemeToggle.jsx";
import NotificationPreferences from "../notifications/NotificationPreferences.jsx";
const ROLE_LABEL = () => ({
  admin: uiT("管理员"),
  teacher: uiT("老师"),
  parent: uiT("家长"),
});
const ROLE_TONE = {
  admin: "default",
  teacher: "success",
  parent: "warning",
};
function InfoRow({ icon: Icon, label, value, mono }) {
  useUiLanguage();
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        {label}
      </span>
      <span
        className={`min-w-0 break-all text-right text-sm font-medium text-gray-900 dark:text-gray-100 ${mono ? "font-mono" : ""}`}
      >
        {value || <span className="text-gray-500 dark:text-gray-400">—</span>}
      </span>
    </div>
  );
}
export default function SettingsPage() {
  useUiLanguage();
  const {
    data: me,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await http("/me")).data,
  });
  return (
    <div className="min-h-full mobile-profile">
      <PageHeader icon={User} title={uiT("账号设置")} subtitle={uiT("个人资料与账号安全")} />

      <main className="page-body space-y-4">
        {me?.role === "teacher" && (
          <Card className="p-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{uiT("界面语言")}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {uiT("语言选择按教师账号记住，不改变课程、反馈或金额。")}
              </p>
            </div>
            <LanguageSwitcher />
          </Card>
        )}
        {me?.role === "admin" && (
          <Link className="mobile-shortcut" to="/admin/features">
            {" " + uiT("全部功能")}{" "}
            <span className="ml-auto text-primary-700 dark:text-primary-300 ">
              {" " + uiT("教学、财务与系统管理 ›") + " "}
            </span>
          </Link>
        )}
        {me && (
          <div className="grid gap-2 sm:grid-cols-2">
            {me.role === "admin" && (
              <Link className="mobile-shortcut" to="/renewals">
                {me.role === "admin" ? "续费订单与收款设置" : "自助续费"}
                <span className="ml-auto">查看 ›</span>
              </Link>
            )}
            {me.role === "teacher" && (
              <Link className="mobile-shortcut" to="/teacher/payroll">
                {" " + uiT("我的课酬")}{" "}
                <span className="ml-auto text-primary-700 dark:text-primary-300 ">
                  {uiT("查看明细 ›")}
                </span>
              </Link>
            )}
            <Link className="mobile-shortcut" to="/schedule">
              {" " + uiT("我的课表")}{" "}
              <span className="ml-auto text-primary-700 dark:text-primary-300 ">
                {uiT("查看 ›")}
              </span>
            </Link>
            <Link className="mobile-shortcut" to="/inbox">
              {" " + uiT("消息通知")}{" "}
              <span className="ml-auto text-primary-700 dark:text-primary-300 ">
                {uiT("查看 ›")}
              </span>
            </Link>
            <Link className="mobile-shortcut" to="/content">
              {" " + uiT("公告与教材")}{" "}
              <span className="ml-auto text-primary-700 dark:text-primary-300 ">
                {uiT("查看 ›")}
              </span>
            </Link>
          </div>
        )}
        {isPending ? (
          <Card className="p-5 text-sm text-gray-500 dark:text-gray-400 ">
            {uiT("正在加载账号资料…")}
          </Card>
        ) : error ? (
          <Card className="p-5">
            <p role="alert">{uiT("账号资料加载失败，请重试。")}</p>
            <Button className="mt-3" variant="outline" onClick={() => refetch()}>
              {" " + uiT("重新加载") + " "}
            </Button>
          </Card>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-semibold flex items-center justify-center">
                  {(me?.full_name || "?").charAt(0)}
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {me?.full_name || "—"}
                    {me?.role && (
                      <Badge variant={ROLE_TONE[me.role] || "secondary"}>
                        {ROLE_LABEL()[me.role] || me.role}
                      </Badge>
                    )}
                  </h2>
                  <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400">
                    {" " + uiT("账号基础信息") + " "}
                  </div>
                </div>
              </div>
              <InfoRow icon={User} label={uiT("姓名")} value={me?.full_name} />
              <InfoRow
                icon={KeyRound}
                label={uiT("角色")}
                value={ROLE_LABEL()[me?.role] || me?.role}
              />
              <InfoRow icon={Mail} label={uiT("邮箱")} value={me?.email} />
              <InfoRow icon={Phone} label={uiT("手机")} value={me?.phone} />
              <InfoRow icon={Building2} label={uiT("所属机构")} value={me?.branch_name} />
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <h2 className="font-semibold">{uiT("显示与提醒")}</h2>
                <NotificationPreferences role={me?.role} />
                <div className="mt-3 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                  <div>
                    <p className="text-sm font-medium">{uiT("界面主题")}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 ">
                      {" " + uiT("在这台设备上使用浅色或深色界面") + " "}
                    </p>
                  </div>
                  <ThemeToggle />
                </div>
                <Link
                  to="/inbox"
                  className="mt-3 flex items-center justify-between text-sm text-primary-700 dark:text-primary-300"
                >
                  {" " + uiT("查看课程与教务通知") + " "}
                  <span>›</span>
                </Link>
                {me?.role === "admin" && (
                  <Link
                    to="/admin/assistant"
                    className="mt-3 flex items-center justify-between text-sm text-primary-700 dark:text-primary-300"
                  >
                    {" " + uiT("管理员微信助手与定时提醒") + " "}
                    <span>›</span>
                  </Link>
                )}
              </Card>
              <Card className="p-6">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-2">
                  <KeyRound className="w-4 h-4 text-gray-500 dark:text-gray-400 dark:text-gray-400" />
                  {" " + uiT("修改密码") + " "}
                </h2>
                <ChangePasswordForm />
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
