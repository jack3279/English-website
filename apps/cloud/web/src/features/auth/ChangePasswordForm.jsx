import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth.js";
import { http } from "../../lib/http.js";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
export default function ChangePasswordForm() {
  useUiLanguage();
  const {
    user,
    logout
  } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (next !== confirmation) {
      setError(uiT("两次输入的新密码不一致"));
      return;
    }
    if (next.length < 10 || next.length > 128 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
      setError(uiT("新密码须为 10～128 位，并包含字母和数字"));
      return;
    }
    setBusy(true);
    try {
      await http("/me/password", {
        method: "POST",
        body: {
          current_password: current,
          new_password: next
        }
      });
      setCurrent("");
      setNext("");
      setConfirmation("");
      logout();
      navigate("/login", {
        replace: true,
        state: {
          passwordChanged: true
        }
      });
    } catch (failure) {
      setError(failure.message || uiT("密码修改失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={submit} className="space-y-3">
      {user?.password_change_recommended && <p role="status" className="rounded-lg bg-warning-50 p-3 text-sm text-warning-800 dark:bg-warning-900/25 dark:text-warning-300 ">{" " + uiT("当前使用测试初始密码，请在正式运营前更换。") + " "}</p>}
      <p className="text-sm text-gray-500 dark:text-gray-400 ">{" " + uiT("验证当前密码后修改。新密码至少 10 位，包含字母和数字；修改成功后重新登录。") + " "}</p>
      <input type="hidden" autoComplete="username" value={user?.email || ""} readOnly />
      <div className="space-y-1.5">
        <Label htmlFor="current-password">{uiT("当前密码")}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required maxLength={128} disabled={busy} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{uiT("新密码")}</Label>
        <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} required minLength={10} maxLength={128} disabled={busy} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">{uiT("确认新密码")}</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={10} maxLength={128} disabled={busy} />
      </div>
      {error && <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
          {error}
        </p>}
      <Button type="submit" disabled={busy}>
        {busy ? uiT("正在修改…") : uiT("修改密码并重新登录")}
      </Button>
    </form>;
}
