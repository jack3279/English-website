import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Label } from "../../components/ui/label.jsx";
import { http } from "../../lib/http.js";
export default function LeadConversionDialog({ lead, onClose }) {
  const draft = lead.conversion_draft || {},
    navigate = useNavigate(),
    qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: draft.full_name || lead.child_name || "",
    birth_date: draft.birth_date || "",
    branch_id: draft.branch_id || "",
    existing_student_id: draft.existing_student_id || "",
    parent_id: draft.parent_id || "",
  });
  const [password, setPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await http("/branches")).data || [],
  });
  const parents = useQuery({
    queryKey: ["family-parents"],
    queryFn: async () => (await http("/families/parents")).data || [],
  });
  const matches = useQuery({
    queryKey: ["conversion-students", form.full_name],
    queryFn: async () =>
      (await http(`/students?pageSize=20&search=${encodeURIComponent(form.full_name)}`)).data || [],
    enabled: !!form.full_name.trim(),
  });
  useEffect(() => {
    if (!form.branch_id && branches.data?.length === 1)
      setForm((v) => ({ ...v, branch_id: branches.data[0].id }));
  }, [branches.data, form.branch_id]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await http(`/leads/${lead.id}/convert`, {
        method: "POST",
        body: {
          ...form,
          birth_date: form.birth_date || null,
          existing_student_id: form.existing_student_id || null,
          parent_id: form.parent_id || null,
          confirmed,
          current_password: password,
        },
      });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["students"] });
      navigate(`/students/${r.data.student_id}`);
    } catch (e) {
      setError(e.message || "建档未完成，请核对后使用相同资料重试");
      qc.invalidateQueries({ queryKey: ["leads"] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title="成交建档"
      description={`${lead.parent_name} · ${lead.intended_course || "尚未填写意向课程"}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={
              busy ||
              !form.full_name.trim() ||
              !form.branch_id ||
              !confirmed ||
              !password ||
              branches.isError ||
              (form.parent_id && parents.isError)
            }
          >
            {busy ? "处理中…" : "确认建档"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        可关联已有学员，避免重复建档；新档案不自动增加课时或登记收费。建档后请到学员详情录缴费、安排课程。未选择家长账号时可稍后关联。
      </p>
      <div className="space-y-4">
        <div>
          <Label htmlFor="convert-name">学员姓名</Label>
          <Input
            id="convert-name"
            value={form.full_name}
            maxLength={50}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </div>
        {(matches.data?.length > 0 || draft.existing_student_id) && (
          <div>
            <Label htmlFor="convert-existing">同名或相似档案，请先核对</Label>
            <Select
              id="convert-existing"
              value={form.existing_student_id}
              onChange={(e) => setForm({ ...form, existing_student_id: e.target.value })}
            >
              <option value="">确认创建新档案</option>
              {(matches.data || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} · {s.birth_date || "生日未填写"}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="convert-birth">生日（选填）</Label>
            <Input
              id="convert-birth"
              type="date"
              value={form.birth_date}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="convert-branch">归属校区</Label>
            <Select
              id="convert-branch"
              value={form.branch_id}
              onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
            >
              <option value="">请选择校区</option>
              {(branches.data || []).map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="convert-parent">关联已有家长账号（选填）</Label>
          <Select
            id="convert-parent"
            value={form.parent_id}
            onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
          >
            <option value="">稍后在学员详情开通或关联</option>
            {(parents.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.phone || p.email || "请核对身份"}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="convert-password">当前管理员密码</Label>
          <Input
            id="convert-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>我已核对学员身份、现有档案及所选家长的监护关系</span>
        </label>
        {(branches.isError || parents.isError) && (
          <p className="text-sm text-danger-700 dark:text-danger-300" role="alert">
            部分校区或家长资料读取失败，请重试后核对。
          </p>
        )}
        {error && (
          <p className="text-sm text-danger-700 dark:text-danger-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
