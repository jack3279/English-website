import { useState, useId } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone, Send, X, Plus } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Label } from "../../components/ui/label.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
const ROLE_LABEL = { admin: "管理员", teacher: "老师", parent: "家长" };

const TYPE_LABEL = {
  lesson_reminder: "上课提醒",
  lesson_rescheduled: "课程调整",
  lesson_cancelled: "课程取消",
  class_report: "课堂反馈",
  renewal: "续费提醒",
  leave: "请假",
  makeup: "补课",
  lead: "试听报名",
  message: "新消息",
  system: "系统",
};

const TYPE_TONE = {
  lesson_reminder: "warning",
  lesson_rescheduled: "default",
  lesson_cancelled: "destructive",
  class_report: "success",
  renewal: "warning",
  leave: "default",
  makeup: "default",
  lead: "default",
  message: "default",
  system: "secondary",
};

function relativeTime(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const min = Math.floor(d / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export default function NotificationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("all");
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await http("/accounts")).data,
  });
  const recipients = accounts.data?.items ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "notifications"],
    queryFn: async () => (await http("/notifications?limit=200")).data,
  });
  const markRead = useMutation({
    mutationFn: async (ids) => http("/notifications/read", { method: "POST", body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notifications"] }),
    onError: (e) => toast.error(e?.message || "标记已读失败"),
  });

  const items = data?.items ?? [];
  const filtered = filter === "unread" ? items.filter((i) => !i.read) : items;
  const allIds = items.map((i) => i.id);
  const unreadIds = items.filter((i) => !i.read).map((i) => i.id);

  return (
    // 根容器跟其他内容页对齐：min-h-full（不是 min-h-screen）+ 纯色背景（不是渐变）。
    // min-h-screen 会让内容不足一屏时页面自身再撑一屏高度，与 AppLayout 的滚动容器叠加出多余空白条。
    <div className="min-h-full">
      <PageHeader
        icon={Bell}
        title="站内通知管理"
        subtitle={`共 ${items.length} 条 · 未读 ${data?.unread ?? 0}`}
        actions={
          <div className="flex gap-2">
            {unreadIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => markRead.mutate(unreadIds)}>
                <CheckCheck className="w-4 h-4 mr-1" /> 全部标为已读
              </Button>
            )}
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> 发送通知
            </Button>
          </div>
        }
      />

      <main className="page-body space-y-4">
        {/* 过滤 pills */}
        <Segmented
          value={filter}
          onChange={setFilter}
          items={[
            { key: "all", label: `全部 (${items.length})` },
            { key: "unread", label: `未读 (${unreadIds.length})` },
          ]}
        />

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">加载中…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <Bell className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-400 mb-2" />
            <div className="text-sm text-gray-500 dark:text-gray-400">暂无通知</div>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => (
              <Card
                key={n.id}
                className={`p-4 ${!n.read ? "border-l-4 border-l-primary-500" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0">
                    <Megaphone className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {n.title}
                      </span>
                      <Badge variant={TYPE_TONE[n.type] || "default"}>
                        {TYPE_LABEL[n.type] || n.type}
                      </Badge>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-primary-500" />}
                      <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        {relativeTime(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                        {n.body}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {n.target_user
                          ? `→ ${recipients.find((a) => a.id === n.target_user)?.name || recipients.find((a) => a.id === n.target_user)?.email || "指定账号"}`
                          : n.target_role
                            ? `→ ${ROLE_LABEL[n.target_role] || "指定角色"}`
                            : "→ 全平台"}
                      </span>
                      {n.link && (
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary-700 dark:text-primary-400 hover:underline"
                        >
                          查看 →
                        </a>
                      )}
                      {!n.read && (
                        <button
                          onClick={() => markRead.mutate([n.id])}
                          className="text-xs text-primary-700 dark:text-primary-400 hover:underline"
                        >
                          标为已读
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {allIds.length > 0 && data?.unread > 0 && (
          <div className="text-center">
            <button
              onClick={() => markRead.mutate(allIds)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
            >
              全部标为已读 ({data.unread})
            </button>
          </div>
        )}
      </main>

      {showCreate && (
        <CreateNotificationDialog
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
            setShowCreate(false);
            toast.success("通知已发送");
          }}
        />
      )}
    </div>
  );
}

export function CreateNotificationDialog({ onClose, onSuccess }) {
  const formId = useId();
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await http("/accounts")).data,
  });
  const users = accounts.data?.items ?? [];
  const [form, setForm] = useState({
    type: "system",
    title: "",
    body: "",
    target: "all",
    customUser: "",
    link: "",
    role: "parent",
  });
  const matching = users.filter(
    (a) =>
      a.id === form.customUser ||
      `${a.name || ""} ${a.email || ""} ${a.phone || ""}`
        .toLowerCase()
        .includes(term.toLowerCase()),
  );
  const [sending, setSending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (form.target === "user" && !users.some((a) => a.id === form.customUser)) {
      setError("请先选择接收人");
      return;
    }
    setError("");
    setSending(true);
    try {
      const body = {
        type: form.type,
        title: form.title.trim(),
        body: form.body.trim() || null,
        link: form.link.trim() || null,
        target_user: form.target === "user" ? form.customUser.trim() : null,
        target_role: form.target === "role" ? form.role : null,
      };
      await http("/notifications", { method: "POST", body });
      onSuccess();
    } catch (e) {
      setError(e?.message || "通知发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={sending ? undefined : onClose}
      title="发送站内通知"
      description="接收人登录网站后可查看；此操作不会发送微信消息。"
      footer={
        <>
          <Button type="button" variant="outline" disabled={sending} onClick={onClose}>
            取消
          </Button>
          <Button
            form={formId}
            type="submit"
            disabled={sending || !form.title.trim() || (form.target === "user" && !form.customUser)}
          >
            {sending ? "发送中…" : "确认发送"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="nt-title">标题 *</Label>
          <Input
            id="nt-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            placeholder="如: 明天课程临时调整"
            maxLength={120}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nt-body">内容</Label>
          <Textarea
            id="nt-body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="通知详情 (可选)"
            maxLength={2000}
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nt-type">类型</Label>
          <Select
            id="nt-type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>接收对象</Label>
          <div className="flex gap-2 flex-wrap text-sm">
            {[
              { k: "all", l: "全机构" },
              { k: "role", l: "按角色" },
              { k: "user", l: "指定用户" },
            ].map((opt) => (
              <label
                key={opt.k}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 has-[:checked]:bg-primary-50 has-[:checked]:border-primary-300 dark:has-[:checked]:bg-primary-950/40 dark:has-[:checked]:border-primary-800 "
              >
                <input
                  type="radio"
                  name="target"
                  value={opt.k}
                  checked={form.target === opt.k}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                  className="text-primary-700 dark:text-primary-300 "
                />
                {opt.l}
              </label>
            ))}
          </div>
          {form.target === "role" && (
            <Select
              className="mt-2"
              value={form.role || "admin"}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="admin">管理员</option>
              <option value="teacher">老师</option>
              <option value="parent">家长</option>
            </Select>
          )}
          {form.target === "user" && (
            <div className="mt-2 space-y-2">
              <Input
                aria-label="搜索接收人"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="搜索姓名、邮箱或电话"
              />
              {accounts.isError ? (
                <div role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
                  账号加载失败{" "}
                  <Button type="button" variant="outline" onClick={() => accounts.refetch()}>
                    重试
                  </Button>
                </div>
              ) : (
                <Select
                  aria-label="选择接收人"
                  required
                  value={form.customUser}
                  disabled={accounts.isLoading}
                  onChange={(e) => setForm({ ...form, customUser: e.target.value })}
                >
                  <option value="">{accounts.isLoading ? "正在加载…" : "请选择接收人"}</option>
                  {matching.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || "未填写姓名"} · {ROLE_LABEL[a.role]} ·{" "}
                      {a.email || a.phone || "未填写联系方式"}
                    </option>
                  ))}
                </Select>
              )}
              {!accounts.isLoading && !accounts.isError && matching.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 ">
                  未找到匹配账号，请先在账号管理中开通。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nt-link">链接 (可选)</Label>
          <Input
            id="nt-link"
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
            placeholder="如: /schedule 或 https://..."
            maxLength={200}
          />
        </div>
      </form>
    </Dialog>
  );
}
