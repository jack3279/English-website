import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AuthShell } from "../../components/AuthShell.jsx";
export default function ForgotPasswordPage() {
  useUiLanguage();
  return <AuthShell title={uiT("找回账号")} subtitle={uiT("核实身份后恢复账号访问")} footer={<Link to="/login" className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline dark:text-primary-300 ">
          <ArrowLeft className="h-3 w-3" />{" " + uiT("返回登录") + " "}</Link>}>
      <div className="space-y-4 text-sm text-gray-600 dark:text-gray-400 ">
        <div className="flex items-start gap-2 rounded-lg bg-primary-50 p-4 dark:bg-primary-950/40 ">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300 " />
          <p>{uiT("忘记密码时，请联系学校教务，提供注册邮箱及学员或教师信息，核实身份后恢复账号。")}</p>
        </div>
        <p>{uiT("如果你仍能登录，可以进入「头像菜单 → 账号设置」，验证当前密码后修改密码。")}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 ">{" " + uiT("请勿向他人提供密码或登录验证码。") + " "}</p>
      </div>
    </AuthShell>;
}
