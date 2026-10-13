import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MessageSquare, Send, Plus, Check, User, Mail } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";
const ROLE_TONE = {
  admin: "default",
  teacher: "success",
  parent: "warning"
};
const ROLE_LABEL = () => ({
  admin: uiT("管理员"),
  teacher: uiT("老师"),
  parent: uiT("家长")
});
function ComposeModal({
  onClose,
  onSent,
  initial = {}
}) {
  useUiLanguage();
  const toast = useToast();
  const [form, setForm] = useState({
    to_user: "",
    subject: "",
    body: "",
    ...initial
  });
  const [err, setErr] = useState(null);
  const {
    data: teammates = []
  } = useQuery({
    queryKey: ["messages", "teammates"],
    queryFn: async () => (await http("/messages/teammates")).data ?? [],
    enabled: !initial.to_user
  });
  const send = useMutation({
    mutationFn: async body => http("/messages", {
      method: "POST",
      body
    }),
    onSuccess: () => {
      onSent();
      onClose();
      toast.success(uiT("站内信已发送"));
    },
    onError: e => setErr(e)
  });
  return <Dialog open onClose={onClose} title={uiT("发新站内信")} description={uiT("给同机构的老师/家长/管理员发站内消息")} footer={<>
          <Button variant="outline" onClick={onClose}>{" " + uiT("取消") + " "}</Button>
          <Button disabled={send.isPending || !form.to_user || !form.body.trim()} onClick={() => send.mutate(form)}>
            <Send className="w-4 h-4 mr-1" />
            {send.isPending ? uiT("发送中...") : uiT("发送")}
          </Button>
        </>}>
      <form onSubmit={e => {
      e.preventDefault();
      send.mutate(form);
    }} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="msg-to" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("收件人 *") + " "}</label>
          <select id="msg-to" required value={form.to_user} onChange={e => setForm({
          ...form,
          to_user: e.target.value
        })} className="flex h-10 w-full rounded-md border border-gray-300 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 ">
            <option value="">{uiT("-- 选择收件人 --")}</option>
            {initial.to_user && <option value={initial.to_user}>{initial.to_name || uiT("原发件人")}</option>}
            {teammates.map(u => <option key={u.id} value={u.id}>
                {u.full_name} ({ROLE_LABEL()[u.role] || u.role})
              </option>)}
          </select>
          {teammates.length === 0 && !initial.to_user && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{uiT("本机构暂无其他用户")}</div>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="msg-subject" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("主题") + " "}</label>
          <Input id="msg-subject" value={form.subject} onChange={e => setForm({
          ...form,
          subject: e.target.value
        })} placeholder={uiT("可选, 简短描述")} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="msg-body" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("内容 *") + " "}</label>
          <textarea id="msg-body" required rows={5} value={form.body} onChange={e => setForm({
          ...form,
          body: e.target.value
        })} className="flex w-full rounded-md border border-gray-300 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 " placeholder={uiT("写点什么...")} />
        </div>
        {err && <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:text-danger-300 dark:bg-danger-900/25 dark:border-danger-800 ">
            {err.message}
          </div>}
      </form>
    </Dialog>;
}
function avatarColor(name) {
  const tones = ["bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ", "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ", "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ", "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 "];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = hash * 31 + name.charCodeAt(i) & 0xffff;
  return tones[hash % tones.length];
}
export default function MessagesPage() {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const [selected, setSelected] = useState(null),
    [search, setSearch] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  // null = 关闭; {} = 空白新信; { to_user } = 回复某家长(预填收件人)
  const [compose, setCompose] = useState(null);
  const {
    data: inbox = [],
    isLoading,
    error: inboxError,
    refetch: retryInbox
  } = useQuery({
    queryKey: ["messages", filter],
    queryFn: async () => {
      const url = filter === "unread" ? "/messages?status=unread" : "/messages";
      return (await http(url)).data ?? [];
    },
    refetchInterval: 30_000
  });
  const {
    data: unread
  } = useQuery({
    queryKey: ["messages", "unread-count"],
    queryFn: async () => (await http("/messages/unread-count")).data
  });
  const markRead = useMutation({
    mutationFn: async id => http(`/messages/${id}`, {
      method: "PATCH"
    }),
    onMutate: async id => {
      await qc.cancelQueries({
        queryKey: ["messages"]
      });
      const prev = qc.getQueryData(["messages", filter]);
      qc.setQueryData(["messages", filter], old => (old ?? []).map(m => m.id === id ? {
        ...m,
        read_at: new Date().toISOString()
      } : m));
      return {
        prev
      };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["messages", filter], ctx.prev);
      toast.error(uiT("标记已读失败"));
    },
    onSettled: () => qc.invalidateQueries({
      queryKey: ["messages"]
    })
  });
  return <div className="min-h-full">
      <PageHeader icon={MessageSquare} title={uiT("站内信")} subtitle={inboxError ? uiT("会话读取失败，请重试") : isLoading ? uiT("正在读取会话…") : unread?.count > 0 ? uiT("共 {0} 条 · 未读 {1} · 每 30s 自动刷新", [inbox.length, unread.count]) : uiT("共 {0} 条 · 已全部读完", [inbox.length])} actions={user?.role === "admin" && <Button onClick={() => setCompose({})}>
              <Plus className="w-4 h-4 mr-1" />{" " + uiT("发新信") + " "}</Button>} />

      <main className="page-body space-y-4">
        <Segmented value={filter} onChange={setFilter} items={[{
        key: "all",
        label: uiT("全部 ({0})", [inbox.length])
      }, {
        key: "unread",
        label: uiT("未读 ({0})", [unread?.count ?? 0])
      }]} />
        <Input aria-label={uiT("搜索会话")} placeholder={uiT("搜索发件人、主题或消息")} value={search} onChange={e => setSearch(e.target.value)} />

        {isLoading ? <LoadingCard /> : inboxError ? <Card role="alert" className="p-6">{" " + uiT("会话读取失败")}{" "}
            <Button onClick={() => retryInbox()} variant="outline">{" " + uiT("重试") + " "}</Button>
          </Card> : inbox.length === 0 ? <Card className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
              <Mail className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{uiT("收件箱是空的")}</div>
          </Card> : <div className="grid gap-4 lg:grid-cols-[minmax(240px,.7fr)_minmax(0,1.5fr)]">
            <Card className={`overflow-hidden p-0 ${selected ? "hidden lg:block" : ""}`}>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 ">
                {inbox.filter(m => `${m.from_user_profile?.full_name || ""} ${m.subject || ""} ${m.body || ""}`.toLowerCase().includes(search.toLowerCase())).map(m => {
              const unread = !m.read_at;
              const sender = m.from_user_profile;
              return <li key={m.id} className={`px-5 py-4 ${unread ? "bg-blue-50/30 dark:bg-blue-950/30" : ""} transition`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-full font-semibold flex items-center justify-center flex-shrink-0 ${avatarColor(sender?.full_name)}`}>
                            {(sender?.full_name || "?").charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <button className="w-full text-left text-sm font-semibold text-primary-700 dark:text-primary-300" onClick={() => setSelected(m.id)}>
                              {sender?.full_name || uiT("会话")} · {m.subject || uiT("查看消息")}
                            </button>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-medium ${unread ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}>
                                {sender?.full_name || uiT("未知发件人")}
                              </span>
                              {sender?.role && <Badge variant={ROLE_TONE[sender.role] || "secondary"}>
                                  {ROLE_LABEL()[sender.role] || sender.role}
                                </Badge>}
                              {unread && <span className="w-2 h-2 rounded-full bg-primary-500" />}
                              <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 shrink-0">
                                {new Date(m.created_at).toLocaleString(uiLocale(), {
                          timeZone: "Asia/Shanghai",
                          hour12: false
                        })}
                              </span>
                            </div>
                            {m.subject && <div className={`mt-1 text-sm ${unread ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}>
                                {m.subject}
                              </div>}
                            <div className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                              {m.body}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              {unread && <button onClick={() => markRead.mutate(m.id)} disabled={markRead.isPending} className="text-xs px-2 h-6 inline-flex items-center gap-1 rounded text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/40 ">
                                  <Check className="w-3 h-3" />{" " + uiT("标为已读") + " "}</button>}
                              {m.from_user && <button onClick={() => setCompose({
                        to_user: m.from_user,
                        to_name: sender?.full_name || uiT("原发件人")
                      })} className="text-xs px-2 h-6 inline-flex items-center gap-1 rounded text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/40 ">
                                  <Send className="w-3 h-3" />{" " + uiT("回复") + " "}</button>}
                            </div>
                          </div>
                        </div>
                      </li>;
            })}
              </ul>
            </Card>
            <Card className={`p-5 ${selected ? "" : "hidden lg:block"}`}>
              {selected ? (() => {
            const message = inbox.find(m => m.id === selected);
            return message ? <>
                      <Button variant="ghost" className="mb-4 lg:hidden" onClick={() => setSelected(null)}>{" " + uiT("‹ 返回会话列表") + " "}</Button>
                      <h2 className="text-lg font-semibold">{message.subject || uiT("消息详情")}</h2>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {message.from_user_profile?.full_name || uiT("发件人")} ·{" "}
                        {new Date(message.created_at).toLocaleString(uiLocale(), {
                  timeZone: "Asia/Shanghai"
                })}
                      </p>
                      <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7">
                        {message.body}
                      </p>
                      <div className="mt-6 flex flex-wrap gap-3">
                        {!message.read_at && <Button variant="outline" onClick={() => markRead.mutate(message.id)} disabled={markRead.isPending}>{" " + uiT("标为已读") + " "}</Button>}
                        {message.from_user && <Button onClick={() => setCompose({
                  to_user: message.from_user,
                  to_name: message.from_user_profile?.full_name || uiT("原发件人")
                })}>{" " + uiT("回复") + " "}</Button>}
                      </div>
                    </> : <p>{uiT("该会话已不在当前列表中")}</p>;
          })() : <div className="py-20 text-center text-sm text-gray-500 dark:text-gray-400">{" " + uiT("选择一条会话，查看完整内容并回复") + " "}</div>}
            </Card>
          </div>}
      </main>

      {compose !== null && <ComposeModal initial={compose} onClose={() => setCompose(null)} onSent={() => qc.invalidateQueries({
      queryKey: ["messages"]
    })} />}
    </div>;
}
