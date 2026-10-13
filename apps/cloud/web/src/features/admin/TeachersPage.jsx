import { Link, useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import CreateAccountDialog from "./CreateAccountDialog.jsx";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Edit2, Users, Mail, Phone, Tag, Search } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";

function avatarColor(name) {
  const tones = [
    "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ",
    "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ",
    "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ",
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ",
  ];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return tones[hash % tones.length];
}

export function TeacherFormModal({ initial, onClose, onSubmit, submitting, profiles = [] }) {
  // 老师课酬按 pay_currency 结算（外教默认 PHP）；学生收费才是人民币，两者不是一个口径
  const currency = initial?.pay_currency || "PHP";
  // 编辑时当前教师一般不在 candidates 里（后端已排除在库教师），补进选项避免下拉空白
  const options = initial?.profile_id
    ? [
        { id: initial.profile_id, full_name: initial.full_name || "（当前教师）", role: "teacher" },
        ...profiles.filter((p) => p.id !== initial.profile_id),
      ]
    : profiles;
  const [form, setForm] = useState({
    profile_id: initial?.profile_id || "",
    // 接口统一返回 string[]；这里兜底兼容逗号串，编辑时回填成 "a, b"
    specialties: (Array.isArray(initial?.specialties)
      ? initial.specialties
      : ((initial?.specialties || "") + "")
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)
    ).join(", "),
    hourly_pay: initial?.hourly_pay ?? 0,
    active: initial?.active ?? true,
    wecom_user_id: initial?.wecom_user_id || "",
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial ? "编辑教师" : "新增教师"}
      description={initial ? initial.full_name : "选择已开通账号的教师"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={submitting || !form.profile_id}
            onClick={() =>
              onSubmit({
                profile_id: form.profile_id,
                specialties: form.specialties
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
                hourly_pay: Number(form.hourly_pay) || 0,
                active: form.active,
                wecom_user_id: form.wecom_user_id || null,
              })
            }
          >
            {submitting ? "保存中..." : "保存"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="t-profile">关联用户 *</Label>
          <select
            id="t-profile"
            required
            value={form.profile_id}
            onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
            disabled={!!initial}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">-- 选择用户 --</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.role}) {p.phone ? `· ${p.phone}` : ""}
              </option>
            ))}
          </select>
          {options.length === 0 && (
            <p className="text-xs text-warning-600 dark:text-warning-400">
              暂无可添加的教师账号，请先开通教师账号。
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-specs">专长 (用逗号分隔)</Label>
          <Input
            id="t-specs"
            value={form.specialties}
            onChange={(e) => setForm({ ...form, specialties: e.target.value })}
            placeholder="例: kids, teens, business"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-rate">课酬单价 ({currency}/小时)</Label>
          <Input
            id="t-rate"
            type="number"
            min="0"
            step="0.01"
            value={form.hourly_pay}
            onChange={(e) => setForm({ ...form, hourly_pay: e.target.value })}
            placeholder="0"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            老师课酬按 {currency} 结算（学生收费另按人民币计）。改这里等于改「财务报表 →
            课酬」里的单价。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="t-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="w-4 h-4 text-primary-700 rounded dark:text-primary-300 "
          />
          <Label htmlFor="t-active">在职 (排课时可选)</Label>
        </div>
      </div>
    </Dialog>
  );
}

export default function TeachersPage() {
  const [accountOpen, setAccountOpen] = useState(false);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [params] = useSearchParams();
  const keyword = params.get("search") || "";
  const [search, setSearch] = useState(keyword);
  useEffect(() => setSearch(keyword), [keyword]);
  const [status, setStatus] = useState("all");

  const {
    data: teachers = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["teachers", "list"],
    queryFn: async () => (await http("/teachers")).data ?? [],
  });

  // 新增教师时选择「teacher 角色但还没入库」的用户
  const { data: candidates = [] } = useQuery({
    queryKey: ["teachers", "candidates"],
    queryFn: async () => (await http("/teachers/candidates")).data ?? [],
    enabled: showForm && !editing,
  });

  const toast = useToast();
  const createMut = useMutation({
    mutationFn: async (body) => http("/teachers", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers"] });
      setShowForm(false);
      setEditing(null);
      toast.success("教师已添加");
    },
    onError: (e) => toast.error(e?.message || "添加失败"),
  });
  const updateMut = useMutation({
    mutationFn: async ({ id, body }) => http(`/teachers/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers"] });
      setShowForm(false);
      setEditing(null);
      toast.success("教师已更新");
    },
    onError: (e) => toast.error(e?.message || "更新失败"),
  });
  const activeCount = teachers.filter((t) => t.active).length;
  const filteredTeachers = teachers.filter(
    (t) =>
      (status === "all" || (status === "active" ? t.active : !t.active)) &&
      `${t.full_name || ""} ${t.email || ""} ${(t.specialties || []).join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );

  return (
    <div className="min-h-full">
      <PageHeader
        icon={Users}
        title="教师管理"
        actions={
          <>
            <Button onClick={() => setAccountOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              开通教师账号
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              关联已有账号
            </Button>
          </>
        }
      />

      {accountOpen && (
        <CreateAccountDialog open initialRole="teacher" onClose={() => setAccountOpen(false)} />
      )}
      <main className="page-body space-y-5">
        <Card className="overflow-hidden">
          <div className="list-toolbar border-b-0">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400 " />
              <Input
                aria-label="搜索教师"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索姓名、邮箱或专长"
                className="pl-9"
              />
            </div>
            <Segmented
              value={status}
              onChange={setStatus}
              items={[
                { key: "all", label: `全部 ${teachers.length}` },
                { key: "active", label: `在职 ${activeCount}` },
                { key: "inactive", label: `离职 ${teachers.length - activeCount}` },
              ]}
            />
          </div>
        </Card>
        {isError ? (
          <Card role="alert" className="p-6 text-sm text-danger-700 dark:text-danger-300 ">
            教师资料加载失败。
            <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
              重试
            </Button>
          </Card>
        ) : isLoading ? (
          <LoadingCard />
        ) : filteredTeachers.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
              <Users className="w-6 h-6 text-gray-500 dark:text-gray-400 " />
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {teachers.length ? "没有匹配的教师" : "还没有教师"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {teachers.length ? "尝试更换搜索词或状态筛选" : "请先开通教师账号，再添加教师档案"}
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredTeachers.map((t) => (
              <Card key={t.id} className="p-5 transition-shadow hover:shadow-card-hover">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-11 h-11 rounded-full font-semibold flex items-center justify-center flex-shrink-0 ${avatarColor(t.full_name)}`}
                  >
                    {(t.full_name || "?").charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/admin/teachers/${t.id}`}
                        className="font-semibold text-primary-700 dark:text-primary-300 hover:underline"
                      >
                        {t.full_name || "?"}
                      </Link>
                      {t.active ? (
                        <Badge variant="success">在职</Badge>
                      ) : (
                        <Badge variant="secondary">离职</Badge>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
                      {t.email && (
                        <div className="flex items-start gap-1.5 break-all">
                          <Mail className="mt-0.5 w-3 h-3 shrink-0" />
                          {t.email}
                        </div>
                      )}
                      {t.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3" />
                          {t.phone}
                        </div>
                      )}
                    </div>
                    {(t.specialties ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(t.specialties ?? []).map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditing(t);
                        setShowForm(true);
                      }}
                      aria-label={`编辑${t.full_name || "教师"}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" /> 编辑
                    </Button>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-gray-800">
                  <span className="text-xs text-gray-500 dark:text-gray-400 ">课酬单价</span>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {t.hourly_pay ?? 0}{" "}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ">
                      {t.pay_currency || "PHP"} / 小时
                    </span>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <TeacherFormModal
          initial={editing}
          submitting={createMut.isPending || updateMut.isPending}
          profiles={candidates}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSubmit={(body) => {
            if (editing) updateMut.mutate({ id: editing.id, body });
            else createMut.mutate(body);
          }}
        />
      )}
    </div>
  );
}
