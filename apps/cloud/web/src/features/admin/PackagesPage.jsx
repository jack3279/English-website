import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, GraduationCap, DollarSign, TrendingUp } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { useToast } from "../../components/ui/toast.jsx";

function PackageFormModal({ initial, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    hours: initial?.hours ?? 10,
    price_cents: initial ? initial.price_cents / 100 : 0,
    active: initial?.active ?? true,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? "编辑课程包" : "新建课程包"}
      description={initial ? `ID: ${initial.id.slice(0, 8)}…` : "添加新的课时套餐供家长购买"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name: form.name.trim(),
                hours: Number(form.hours),
                price_cents: Math.round(Number(form.price_cents) * 100),
                active: form.active,
              })
            }
            disabled={submitting || !form.name.trim()}
          >
            {submitting ? "保存中..." : "保存"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name: form.name.trim(),
            hours: Number(form.hours),
            price_cents: Math.round(Number(form.price_cents) * 100),
            active: form.active,
          });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <label
            htmlFor="pkg-name"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            课程包名称 *
          </label>
          <Input
            id="pkg-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="例: 30 课时包"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="pkg-hours"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              课时数 *
            </label>
            <Input
              id="pkg-hours"
              type="number"
              min="0.5"
              step="0.5"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="pkg-price"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              售价 (元) *
            </label>
            <Input
              id="pkg-price"
              type="number"
              min="0"
              step="0.01"
              value={form.price_cents}
              onChange={(e) => setForm({ ...form, price_cents: e.target.value })}
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="pkg-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="w-4 h-4 text-primary-700 rounded dark:text-primary-300 "
          />
          <label htmlFor="pkg-active" className="text-sm text-gray-700 dark:text-gray-300">
            上架中 (家长可见可购买)
          </label>
        </div>
      </form>
    </Dialog>
  );
}

export default function PackagesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ["packages", "types"],
    queryFn: async () => (await http("/packages/types")).data ?? [],
  });

  const toast = useToast();
  const save = useMutation({
    mutationFn: async (body) => {
      if (editing) return http(`/packages/types/${editing.id}`, { method: "PATCH", body });
      return http("/packages/types", { method: "POST", body });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["packages", "types"] });
      setShowForm(false);
      setEditing(null);
      toast.success(editing ? "课程包已更新" : `课程包「${vars.name}」已创建`);
    },
    onError: (e) => toast.error(e?.message || "保存失败"),
  });

  const del = useMutation({
    mutationFn: async (id) => http(`/packages/types/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages", "types"] });
      toast.success("课程包已删除");
    },
    onError: (e) => toast.error(e?.message || "删除失败"),
  });

  const active = types.filter((t) => t.active);
  const inactive = types.filter((t) => !t.active);

  return (
    <div className="min-h-full">
      <PageHeader
        icon={GraduationCap}
        title="课时包管理"
        subtitle="管理售卖给学员的课时套餐, 教务在学员详情页开通并扣课时"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> 新建课程包
          </Button>
        }
      />

      <main className="page-body space-y-6">
        {isLoading ? (
          <LoadingCard />
        ) : types.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary-50 flex items-center justify-center mb-2 dark:bg-primary-950/40 ">
              <GraduationCap className="w-6 h-6 text-primary-500" />
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">还没有课时包</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1">
              新建第一个课程包开始销售
            </div>
            <Button className="mt-3" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-1" /> 新建第一个
            </Button>
          </Card>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">上架中</h2>
                  <Badge variant="success">{active.length}</Badge>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {active.map((t) => (
                    <PackageCard
                      key={t.id}
                      pkg={t}
                      onEdit={() => {
                        setEditing(t);
                        setShowForm(true);
                      }}
                      onDelete={() => {
                        if (confirm(`确定删除"${t.name}"?`)) del.mutate(t.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            {inactive.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">已下架</h2>
                  <Badge variant="secondary">{inactive.length}</Badge>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
                  {inactive.map((t) => (
                    <PackageCard
                      key={t.id}
                      pkg={t}
                      onEdit={() => {
                        setEditing(t);
                        setShowForm(true);
                      }}
                      onDelete={() => {
                        if (confirm(`确定删除"${t.name}"?`)) del.mutate(t.id);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {showForm && (
        <PackageFormModal
          initial={editing}
          submitting={save.isPending}
          onSubmit={(body) => save.mutate(body)}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PackageCard({ pkg, onEdit, onDelete }) {
  const yuan = (pkg.price_cents / 100).toFixed(2);
  const perHour = (pkg.price_cents / 100 / pkg.hours).toFixed(2);
  return (
    <Card className="hover:border-primary-300 hover:shadow-md transition group dark:hover:border-primary-800 ">
      <div className="flex items-start justify-between mb-3">
        <div className="font-semibold text-gray-900 dark:text-gray-100">{pkg.name}</div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 dark:text-gray-400 dark:text-gray-400 hover:text-primary-700 dark:hover:bg-gray-800 dark:hover:text-primary-300 "
            aria-label="编辑"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 dark:text-gray-400 dark:text-gray-400 hover:text-danger-600 dark:hover:bg-gray-800 dark:hover:text-danger-300 "
            aria-label="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold text-primary-700 dark:text-primary-300 ">¥{yuan}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400">
          / {pkg.hours} 课时
        </span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 flex items-center gap-1">
        <TrendingUp className="w-3 h-3" />
        折合 ¥{perHour} / 课时
      </div>
    </Card>
  );
}
