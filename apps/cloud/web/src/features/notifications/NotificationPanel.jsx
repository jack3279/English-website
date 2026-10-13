import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
// 通知面板（纯展示，无按钮外壳）。
// 抽出来是为了让顶栏铃铛和侧边栏「通知中心」入口共用同一份弹层逻辑 ——
// 两处各写一份的话，「全部已读」和跳转行为迟早会不一致。
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck, ChevronRight } from "lucide-react";
import { Loading } from "../../components/ui/loading.jsx";
import { useNotifications, useMarkNotificationsRead } from "./useNotifications.js";
import { useAuth } from "../auth/useAuth.js";
import { notificationLink } from "../../lib/notificationLink.js";

// 弹层最多渲染这么多条, 超出的部分交给 /inbox 全量页。
// 与 useNotifications 里请求的 limit=50 对齐, 否则「查看全部」会误导成还有更多。
const PANEL_LIMIT = 50;
const TYPE_LABEL = () => ({
  lesson_reminder: uiT("上课提醒"),
  lesson_rescheduled: uiT("课程调整"),
  lesson_cancelled: uiT("课程取消"),
  class_report: uiT("课堂反馈"),
  renewal: uiT("续费提醒"),
  leave: uiT("请假"),
  makeup: uiT("补课"),
  lead: uiT("试听报名"),
  message: uiT("新消息"),
  system: uiT("系统")
});
export function relativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return uiT("刚刚");
  if (min < 60) return uiT("{0} 分钟前", [min]);
  const hour = Math.floor(min / 60);
  if (hour < 24) return uiT("{0} 小时前", [hour]);
  const day = Math.floor(hour / 24);
  if (day < 30) return uiT("{0} 天前", [day]);
  return new Date(iso).toLocaleDateString(uiLocale(), {
    timeZone: "Asia/Shanghai"
  });
}
export function NotificationPanel({
  onNavigate,
  enabled = true
}) {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const navigate = useNavigate();
  const boxRef = useRef(null);
  // enabled=false 时不取数据（面板还没打开）。弹层是常驻 DOM 的，
  // 不加这个开关就等于铃铛一直挂着 50 条通知的请求。
  const {
    data,
    isLoading
  } = useNotifications({
    enabled
  });
  const markRead = useMarkNotificationsRead();
  const items = (data?.items ?? []).filter(item => !item.muted);
  const unread = data?.unread ?? 0;
  useEffect(() => {
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) onNavigate?.();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onNavigate]);
  function openItem(item) {
    markRead.mutate([item.id]);
    if (item.link) {
      navigate(notificationLink(item.link, user?.role));
      onNavigate?.();
    }
  }

  // 弹窗只负责「快速看一眼 + 全部已读」, 完整列表交给 /inbox。
  // 没有这个出口的话, 超过 PANEL_LIMIT 条的通知就永远看不到 —— 弹层高度是死的。
  const hasMore = items.length >= PANEL_LIMIT;
  return <div className="w-full sm:w-80 rounded-lg border border-gray-200 bg-white shadow-pop dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-100">{" " + uiT("通知") + " "}{unread > 0 && <span className="rounded-full bg-danger-600 px-1.5 text-[11px] font-medium leading-4 text-white">
              {unread > 99 ? "99+" : unread}
            </span>}
        </span>
        <button type="button" disabled={!unread || markRead.isPending} onClick={() => markRead.mutate()} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100">
          <CheckCheck className="w-3.5 h-3.5" />{" " + uiT("全部已读") + " "}</button>
      </div>

      {/* 列表自己滚动, 头尾固定 —— 否则底部的「查看全部」会跟着滚走 */}
      <div className="max-h-[22rem] overflow-y-auto">
        {isLoading && <Loading />}

        {!isLoading && items.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400 ">{" " + uiT("暂无通知") + " "}</div>}

        {items.map(item => <button key={item.id} type="button" onClick={() => openItem(item)} className="w-full text-left px-3 py-2 border-b border-gray-50 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
            <div className="flex items-start gap-2">
              <span className={item.read ? "mt-1.5 w-1.5 h-1.5 rounded-full bg-transparent" : "mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-500"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-gray-800 dark:text-gray-100">
                    {item.title}
                  </span>
                  {item.type && item.type !== "system" && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {TYPE_LABEL()[item.type] || item.type}
                    </span>}
                </div>
                {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                    {item.body}
                  </p>}
                <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400 ">
                  {relativeTime(item.created_at)}
                </span>
              </div>
            </div>
          </button>)}
      </div>

      <button type="button" onClick={() => {
      navigate("/inbox");
      onNavigate?.();
    }} className="flex w-full items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
        <span>{hasMore ? uiT("查看全部通知") : uiT("打开消息中心")}</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>;
}
