import { useState, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";
import { useToast } from "../../components/ui/toast.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";
const ROLES = { parent: "家长", teacher: "老师", admin: "管理员" };
export default function CreateAccountDialog({
  open,
  onClose,
  initialRole = "parent",
  studentId,
  onCreated,
}) {
  const { user } = useAuth(),
    toast = useToast(),
    qc = useQueryClient();
  const formId = useId();
  const [role, setRole] = useState(initialRole),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState("");
  const [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [current, setCurrent] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [term, setTerm] = useState(""),
    [selected, setSelected] = useState(studentId ? [studentId] : []);
  const [selectedNames, setSelectedNames] = useState({});
  const [rate, setRate] = useState("0"),
    [currency, setCurrency] = useState("PHP");
  const students = useQuery({
    queryKey: ["family-students", term],
    queryFn: async () =>
      (await http(`/students?pageSize=100&search=${encodeURIComponent(term)}`)).data || [],
    enabled: open && role === "parent" && !studentId,
  });
  function close() {
    if (!busy) onClose();
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("密码至少 10 位，包含字母和数字");
      return;
    }
    if (role === "teacher" && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) {
      setError("请填写有效课酬单价");
      return;
    }
    setBusy(true);
    try {
      const body = { name, email, password, current_password: current, confirmed, phone };
      if (role !== "admin") body.role = role;
      if (role === "parent") body.student_ids = selected;
      if (role === "teacher") {
        body.teacher_hourly_pay = Number(rate);
        body.teacher_pay_currency = currency;
      }
      const result = await http(role === "admin" ? "/accounts/admin" : "/accounts/create", {
        method: "POST",
        body,
      });
      setPassword("");
      setConfirmPassword("");
      setCurrent("");
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["teachers"] });
      qc.invalidateQueries({ queryKey: ["family-parents"] });
      qc.invalidateQueries({ queryKey: ["family-links"] });
      toast.success(result.data.message);
      onCreated?.(result.data);
      onClose();
    } catch (failure) {
      setError(failure.message || "开户失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`开通${ROLES[role]}账号`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={busy || !confirmed}>
            {busy ? "正在开户…" : "开通账号"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <input type="hidden" autoComplete="username" value={user?.email || ""} readOnly />
        {!studentId && (
          <div className="space-y-1">
            <Label htmlFor="create-role">账号角色</Label>
            <Select
              id="create-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setSelected([]);
                setSelectedNames({});
                setConfirmed(false);
              }}
              disabled={busy}
            >
              <option value="parent">家长</option>
              <option value="teacher">老师</option>
              <option value="admin">管理员</option>
            </Select>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="create-name">姓名</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-phone">联系电话（选填）</Label>
            <Input
              id="create-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={30}
              disabled={busy}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="create-email">登录邮箱</Label>
          <Input
            id="create-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        {role === "parent" &&
          (studentId ? (
            <p className="rounded-lg bg-primary-50 p-3 text-sm dark:bg-primary-950/40 ">
              开户成功后将自动关联当前学员。已有账号的家长请使用「绑定已有家长」。
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="child-search">关联孩子（可多选，也可稍后绑定）</Label>
              <Input
                id="child-search"
                placeholder="搜索学员姓名"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                disabled={busy}
              />
              <div className="max-h-36 overflow-y-auto rounded-lg border p-2">
                {students.isPending ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 ">正在加载学员…</p>
                ) : students.error ? (
                  <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
                    学员加载失败，请稍后重试
                  </p>
                ) : students.data?.length ? (
                  students.data.map((child) => (
                    <label key={child.id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(child.id)}
                        onChange={(event) => {
                          setSelectedNames((previous) => ({
                            ...previous,
                            [child.id]: child.full_name,
                          }));
                          setSelected((previous) =>
                            event.target.checked
                              ? [...previous, child.id]
                              : previous.filter((id) => id !== child.id),
                          );
                        }}
                        disabled={busy}
                      />
                      {child.full_name}
                      {child.birth_date && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 ">
                          {child.birth_date}
                        </span>
                      )}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 ">
                    没有匹配学员，可稍后在学员详情绑定。
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 ">
                已选择 {selected.length} 位；搜索其他孩子时保留已选项。
              </p>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="rounded-full bg-primary-50 px-2 py-1 text-xs text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 "
                      disabled={busy}
                      onClick={() =>
                        setSelected((previous) => previous.filter((item) => item !== id))
                      }
                    >
                      已选：{selectedNames[id] || "学员"} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        {role === "teacher" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="create-rate">课酬单价（每小时）</Label>
              <Input
                id="create-rate"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="create-currency">课酬币种</Label>
              <Select
                id="create-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                disabled={busy}
              >
                {["PHP", "CNY", "USD", "EUR", "GBP"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <p className="col-span-full text-xs text-gray-500 dark:text-gray-400 ">
              系统同时建立教师档案。单价为 0 时请在排课前核对课酬设置。
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="create-password">初始密码</Label>
            <Input
              id="create-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-confirm-password">确认初始密码</Label>
            <Input
              id="create-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="create-current-password">当前管理员密码</Label>
          <Input
            id="create-current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={busy}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            required
            disabled={busy}
          />
          <span>
            {role === "parent"
              ? "已核实家长身份和所选孩子的监护关系，同意开通查看权限。"
              : role === "teacher"
                ? "已核实教师身份，同意开通教师账号与档案。"
                : "已核实管理员身份，同意授予机构管理权限。"}
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
            {error}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 ">
          密码不回显，请私下交付本人；账号本人可登录后修改密码。
        </p>
      </form>
    </Dialog>
  );
}
