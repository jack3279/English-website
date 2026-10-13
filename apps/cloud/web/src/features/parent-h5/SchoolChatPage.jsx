import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, MessageSquare } from "lucide-react";
import { http } from "../../lib/http.js";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { NotificationBell } from "../notifications/NotificationBell.jsx";
import { useAuth } from "../auth/useAuth.js";
function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

// 家长与「学校 / 教务」的一对一聊天页（微信式气泡）。
// 家长只联系机构，不指定具体某位老师；收件人由后端按同 branch 的 admin 解析。
// 免费版：15s 轮询拉取；后续可用 Realtime 替换 refetchInterval。
export default function SchoolChatPage() {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const prevLen = useRef(0);
  const {
    data,
    isLoading,
    error: loadError
  } = useQuery({
    queryKey: ["school-thread"],
    queryFn: async () => (await http("/messages/school-thread")).data,
    refetchInterval: 15_000
  });
  const messages = data?.messages ?? [];
  function scrollToBottom(smooth) {
    const el = scrollRef.current;
    if (el) el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  }
  // 消息条数变化时跟随到底部（首次加载直接跳，之后发送/新回复平滑滚）。
  // 依赖 messages.length：曾写成无依赖数组（每帧都跑，虽有 prevLen 守卫但违反副作用规范）。
  useEffect(() => {
    if (messages.length !== prevLen.current) {
      scrollToBottom(prevLen.current !== 0);
      prevLen.current = messages.length;
    }
  }, [messages.length]);
  const send = useMutation({
    mutationFn: body => http("/messages/school", {
      method: "POST",
      body: {
        body
      }
    }),
    onSuccess: async () => {
      setDraft("");
      await qc.invalidateQueries({
        queryKey: ["school-thread"]
      });
      scrollToBottom(false);
    },
    // 必须有：曾缺 onError → 留言发送失败时页面毫无反应，
    // 家长以为已发送，等半天没人回（消息根本没到）。
    onError: e => toast.error(e?.message || uiT("发送失败，请重试"))
  });
  function submit() {
    const text = draft.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  }
  return <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
      {/* 顶部标题条 */}
      <div className="school-chat-header flex h-14 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 dark:border-gray-800 dark:bg-gray-900">
        <Button variant="ghost" size="icon" onClick={() => nav(user?.role === "teacher" ? "/teacher/today" : "/parent")} aria-label={uiT("返回")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{uiT("学校 / 教务")}</h1>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{uiT("通常在工作时间内回复")}</div>
        </div>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {isLoading ? <div className="pt-10 text-center text-sm text-gray-500 dark:text-gray-400 ">{uiT("加载中…")}</div> : messages.length === 0 ? <div className="flex flex-col items-center pt-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-500 dark:bg-primary-950/40 ">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{uiT("还没有留言")}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{" " + uiT("有问题可以在这里给学校留言") + " "}</div>
          </div> : messages.map(m => <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[78%]">
                <div className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.mine ? "rounded-br-sm bg-primary-700 text-white" : "rounded-bl-sm bg-white text-gray-800 shadow-sm dark:bg-gray-800 dark:text-gray-100"}`}>
                  {m.body}
                </div>
                <div className={`mt-1 text-[10px] text-gray-500 dark:text-gray-400 ${m.mine ? "text-right" : ""}`}>
                  {fmtTime(m.created_at)}
                </div>
              </div>
            </div>)}
      </div>

      {/* 底部输入条 */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-end gap-2">
          <Textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }} rows={1} placeholder={uiT("输入留言…")} className="max-h-28 min-h-[40px] resize-none py-2" />
          <Button onClick={submit} disabled={!draft.trim() || send.isPending} className="h-10 shrink-0" aria-label={uiT("发送")}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>;
}
