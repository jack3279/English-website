import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Link2 } from "lucide-react";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import CreateAccountDialog from "../admin/CreateAccountDialog.jsx";
const RELATIONS = { mother: "母亲", father: "父亲", guardian: "监护人" };
export default function FamilyPanel({ studentId }) {
  const qc = useQueryClient(),
    toast = useToast();
  const [createOpen, setCreateOpen] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [unlink, setUnlink] = useState(null);
  const [selected, setSelected] = useState(""),
    [relation, setRelation] = useState("guardian"),
    [confirmed, setConfirmed] = useState(false),
    [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const links = useQuery({
    queryKey: ["family-links", studentId],
    queryFn: async () => (await http(`/families/students/${studentId}`)).data || [],
  });
  const parents = useQuery({
    queryKey: ["family-parents"],
    queryFn: async () => (await http("/families/parents")).data || [],
    enabled: linkOpen,
  });
  const available = (parents.data || []).filter(
    (parent) =>
      !links.data?.some((link) => link.id === parent.id) &&
      `${parent.name} ${parent.phone || ""} ${parent.email || ""}`
        .toLowerCase()
        .includes(term.toLowerCase()),
  );
  async function bind(event) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await http(`/families/students/${studentId}`, {
        method: "POST",
        body: { parent_id: selected, relation, confirmed },
      });
      toast.success(response.data.message);
      qc.invalidateQueries({ queryKey: ["family-links", studentId] });
      setLinkOpen(false);
    } catch (failure) {
      setError(failure.message || "绑定失败");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await http(`/families/students/${studentId}/parents/${unlink.id}`, {
        method: "DELETE",
        body: { confirmed: true },
      });
      toast.success(response.data.message);
      qc.invalidateQueries({ queryKey: ["family-links", studentId] });
      setUnlink(null);
    } catch (failure) {
      setError(failure.message || "解除失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4" />
          家长与登录账号
        </h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected("");
              setConfirmed(false);
              setTerm("");
              setError("");
              setLinkOpen(true);
            }}
          >
            <Link2 className="mr-1 h-3.5 w-3.5" />
            绑定已有家长
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            开通家长账号
          </Button>
        </div>
      </div>
      {links.isPending ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 ">正在加载家长…</p>
      ) : links.error ? (
        <div>
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
            家长关联加载失败
          </p>
          <Button variant="outline" size="sm" onClick={() => links.refetch()}>
            重试
          </Button>
        </div>
      ) : links.data?.length ? (
        <ul className="divide-y">
          {links.data.map((parent) => (
            <li key={parent.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">
                  {parent.name}
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 ">
                    {RELATIONS[parent.relation] || parent.relation || "监护人"}
                  </span>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 ">
                  {parent.phone || "未填写联系电话"}
                </p>
                {parent.email && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 ">
                    登录邮箱：{parent.email}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setUnlink(parent);
                  setError("");
                }}
              >
                解除关联
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-800/40 dark:text-gray-400 ">
          还未关联家长。开通或绑定后，家长登录即可查看该孩子的课程和学习反馈。
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 ">
        一个家长账号可关联多个孩子；更换监护人时请先核实身份。解除关联不会删除学员或账号。
      </p>
      {createOpen && (
        <CreateAccountDialog
          open
          initialRole="parent"
          studentId={studentId}
          onClose={() => setCreateOpen(false)}
        />
      )}
      <Dialog
        open={linkOpen}
        onClose={() => {
          if (!busy) setLinkOpen(false);
        }}
        title="绑定已有家长"
      >
        <form onSubmit={bind} className="space-y-3">
          <Label htmlFor="family-search">搜索姓名、电话或邮箱</Label>
          <Input
            id="family-search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            disabled={busy}
          />
          <Label htmlFor="family-parent">家长账号</Label>
          <Select
            id="family-parent"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            required
            disabled={busy || parents.isPending}
          >
            <option value="">选择家长</option>
            {available.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
                {` · ${parent.phone || parent.email || "未填写联系方式"}`}
              </option>
            ))}
          </Select>
          {parents.error && <p role="alert">家长列表加载失败，请重试。</p>}
          <Label htmlFor="family-relation">与孩子的关系</Label>
          <Select
            id="family-relation"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            disabled={busy}
          >
            {Object.entries(RELATIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              disabled={busy}
            />
            <span>已核实监护关系，允许该家长查看孩子的数据。</span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkOpen(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button disabled={busy || !selected || !confirmed || parents.isError}>
              {busy ? "正在绑定…" : "确认绑定"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!unlink}
        onClose={() => {
          if (!busy) setUnlink(null);
        }}
        title="解除家长关联"
      >
        <p className="text-sm">
          解除「{unlink?.name}
          」与当前孩子的关联后，该家长将无法继续查看这个孩子的课程和反馈。孩子的档案、课时和账号仍保留。
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-600 dark:text-danger-300 ">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setUnlink(null)} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? "正在解除…" : "确认解除关联"}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
