import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Search } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";
import { useAuth } from "../auth/useAuth.js";
import CreateAccountDialog from "./CreateAccountDialog.jsx";
const ROLES = { admin: "管理员", teacher: "老师", parent: "家长" };
export default function AccountsPage() {
  const toast = useToast(),
    { user } = useAuth();
  const query = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await http("/accounts")).data,
  });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [resetRow, setResetRow] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [current, setCurrent] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const rows = (query.data?.items || []).filter((row) =>
    `${row.name} ${row.email} ${row.phone || ""} ${ROLES[row.role]}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  function close() {
    if (busy) return;
    setOpen(false);
    setPassword("");
    setConfirmation("");
    setCurrent("");
    setConfirmed(false);
    setError("");
  }
  async function create(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmation) {
      setError("两次输入的新账号密码不一致");
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("密码至少 10 位，包含字母和数字");
      return;
    }
    setBusy(true);
    try {
      const response = await http("/accounts/password", {
        method: "POST",
        body: { id: resetRow.id, password, current_password: current, confirmed },
      });
      setPassword("");
      setConfirmation("");
      setCurrent("");
      setConfirmed(false);
      setOpen(false);
      toast.success(response.data.message);
      query.refetch();
    } catch (failure) {
      setError(failure.message || "密码重置失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-full">
      <PageHeader icon={Users} title="账号管理" subtitle="开通老师与家长账号，管理登录和身份" />
      <main className="page-body space-y-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="relative min-w-48 flex-1 max-w-md">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500 dark:text-gray-400 " />
            <Input
              className="pl-9"
              aria-label="搜索账号"
              placeholder="搜索姓名或邮箱"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            开通账号
          </Button>
        </Card>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400 ">正在加载账号…</p>
          ) : query.error ? (
            <div className="p-5">
              <p role="alert">账号列表加载失败。</p>
              <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>
                重新加载
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>登录邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>最近登录</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell data-label="姓名">
                      {row.name || "—"}
                      {row.id === user?.id && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 ">
                          当前账号
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-label="登录邮箱">{row.email || "未关联登录账号"}</TableCell>
                    <TableCell data-label="角色">{ROLES[row.role] || row.role}</TableCell>
                    <TableCell data-label="最近登录">
                      {row.lastSignInAt
                        ? new Date(row.lastSignInAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            hour12: false,
                          })
                        : "尚无登录记录"}
                    </TableCell>
                    <TableCell data-label="操作">
                      {row.id === user?.id ? (
                        <Link
                          to="/settings"
                          className="text-sm text-primary-700 underline dark:text-primary-300 "
                        >
                          修改我的密码
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!row.email}
                          onClick={() => {
                            setResetRow(row);
                            setPassword("");
                            setConfirmation("");
                            setCurrent("");
                            setConfirmed(false);
                            setError("");
                            setOpen(true);
                          }}
                        >
                          重置密码
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-gray-500 dark:text-gray-400 "
                    >
                      没有找到匹配账号
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
        {query.data?.truncated && (
          <p className="text-sm text-warning-700 dark:text-warning-300 ">
            当前仅展示前 1000 个账号，请联系维护人员导出完整列表。
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400 ">
          老师开户会自动建立教师档案；家长可在开户时关联孩子，也可在学员详情绑定。重置密码前必须核实本人身份，新密码由教务私下交付。
        </p>
      </main>
      {createOpen && (
        <CreateAccountDialog
          open
          onClose={() => setCreateOpen(false)}
          onCreated={() => query.refetch()}
        />
      )}
      <Dialog open={open} onClose={close} title="重置账号密码">
        <form onSubmit={create} className="space-y-3">
          <input type="hidden" autoComplete="username" value={user?.email || ""} readOnly />
          {resetRow && (
            <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800/40 ">
              {resetRow.name} · {resetRow.email}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="account-password">新账号密码</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              maxLength={128}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="account-confirm">确认新账号密码</Label>
            <Input
              id="account-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={10}
              maxLength={128}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="account-current">当前管理员密码</Label>
            <Input
              id="account-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
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
            <span>确认已核实用户身份，同意重置该账号密码。</span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !confirmed}>
              {busy ? "正在保存…" : "确认重置密码"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
