import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Mail, Lock, ArrowRight, AlertCircle, History, Eye, EyeOff } from "lucide-react";
import { useAuth, fetchMe } from "./useAuth.js";
import { getLastEmail } from "../../lib/auth-store.js";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { AuthShell } from "../../components/AuthShell.jsx";
export default function LoginPage() {
  useUiLanguage();
  const {
    login
  } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const last = getLastEmail();
    if (last) setEmail(last);
  }, []);
  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email, password, remember);
      const me = await fetchMe();
      const dest = loc.state?.from || (me.role === "admin" ? "/admin" : me.role === "teacher" ? "/teacher/today" : me.role === "parent" ? "/parent" : "/");
      nav(dest, {
        replace: true
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  return <AuthShell title={uiT("欢迎回来")} footer={<>{uiT("没有账号？请联系教务老师开通。")}</>}>
      {loc.state?.passwordChanged && <p role="status" className="mb-4 rounded-lg bg-success-50 p-3 text-sm text-success-700 dark:bg-success-900/25 dark:text-success-300 ">{" " + uiT("密码已修改，请使用新密码登录。") + " "}</p>}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-email">{uiT("邮箱")}</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400 " />
            <Input id="login-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className="pl-9 pr-14" placeholder={uiT("请输入邮箱")} />
            {getLastEmail() === email && email ? <span className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] text-primary-700 dark:text-primary-400">
                <History className="h-3 w-3" />{" " + uiT("上次") + " "}</span> : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">{uiT("密码")}</Label>
            <Link to="/forgot" className="text-xs text-primary-700 hover:underline dark:text-primary-300 ">{" " + uiT("忘记密码?") + " "}</Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400 " />
            <Input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder={uiT("请输入密码")} className="pl-9 pr-12" />
            <button type="button" aria-label={showPassword ? uiT("隐藏密码") : uiT("显示密码")} aria-controls="login-password" aria-pressed={showPassword} onClick={() => setShowPassword(show => !show)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-300 ">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="group flex cursor-pointer select-none items-center gap-2">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="h-4 w-4 shrink-0 accent-primary-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{" " + uiT("记住此设备 (30 天内自动登录)") + " "}</span>
        </label>

        {err && <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700 ring-1 ring-inset ring-danger-200/60 dark:bg-danger-900/25 dark:text-danger-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>}

        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading ? uiT("登录中…") : uiT("登录")}
          {!loading && <ArrowRight className="ml-1 h-4 w-4" />}
        </Button>
      </form>
    </AuthShell>;
}
