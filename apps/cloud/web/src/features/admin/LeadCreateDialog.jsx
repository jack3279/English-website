import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { http } from "../../lib/http.js";
export default function LeadCreateDialog({ onClose }) {
  const qc = useQueryClient(),
    [form, setForm] = useState({
      parent_name: "",
      parent_phone: "",
      child_name: "",
      intended_course: "",
      trial_date: "",
      notes: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await http("/leads", {
        method: "POST",
        body: { ...form, trial_date: form.trial_date || null },
      });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      onClose();
    } catch (err) {
      setError(err.message || "线索保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="新增招生线索"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} variant="outline">
            取消
          </Button>
          <Button type="submit" form="lead-create-form" disabled={busy}>
            {busy ? "保存中…" : "保存线索"}
          </Button>
        </>
      }
    >
      <form id="lead-create-form" onSubmit={submit} className="space-y-4">
        {[
          ["parent_name", "家长称呼", "text"],
          ["parent_phone", "联系电话", "tel"],
          ["child_name", "孩子姓名", "text"],
          ["intended_course", "意向课程", "text"],
          ["trial_date", "期望试听日期", "date"],
        ].map(([key, label, type]) => (
          <div key={key}>
            <Label htmlFor={`lead-${key}`}>{label}</Label>
            <Input
              id={`lead-${key}`}
              type={type}
              required={key === "parent_name" || key === "parent_phone"}
              maxLength={key === "parent_phone" ? 20 : 80}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <div>
          <Label htmlFor="lead-notes">备注</Label>
          <Textarea
            id="lead-notes"
            maxLength={500}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-700 dark:text-danger-300">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
