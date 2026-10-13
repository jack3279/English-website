import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useNotifications, useMarkNotificationsRead } from "./useNotifications.js";
import { relativeTime } from "./NotificationPanel.jsx";
import { useAuth } from "../auth/useAuth.js";
import { useState } from "react";
import { notificationLink } from "../../lib/notificationLink.js";
import { Segmented } from "../../components/ui/segmented.jsx";
const groups = () => [{
  key: "all",
  label: uiT("全部")
}, {
  key: "course",
  label: uiT("课程"),
  types: ["lesson_reminder", "lesson_rescheduled", "lesson_cancelled", "class_report"]
}, {
  key: "operations",
  label: uiT("教务"),
  types: ["leave", "makeup", "renewal", "lead"]
}, {
  key: "other",
  label: uiT("其他"),
  types: ["message", "system"]
}];
export default function InboxPage() {
  useUiLanguage();
  const [group, setGroup] = useState("all"),
    [onlyUnread, setOnlyUnread] = useState(false);
  const {
      data,
      isLoading,
      error,
      refetch
    } = useNotifications(),
    mark = useMarkNotificationsRead(),
    {
      user
    } = useAuth();
  const items = data?.items || [];
  const unreadTotal = data?.unreadTotal ?? data?.unread ?? 0;
  const selectedGroup = groups().find(g => g.key === group);
  const shown = items.filter(item => (!onlyUnread || !item.read) && (group === "all" || selectedGroup.types.includes(item.type) || group === "other" && !groups().slice(1, 3).some(g => g.types.includes(item.type))));
  return <div className="min-h-full">
      <PageHeader title={uiT("消息")} icon={Bell} subtitle={uiT("课程提醒与学校通知")} />
      <main className="page-body space-y-3">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{uiT("通知中心")}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 ">{" " + uiT("最近") + " "}{items.length}{" " + uiT("条 · 未读") + " "}{unreadTotal}{" " + uiT("条") + " "}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)} />{" " + uiT("只看未读") + " "}</label>
          </div>
          <Segmented value={group} onChange={setGroup} items={groups().map(({
          key,
          label
        }) => ({
          key,
          label
        }))} />
        </Card>
        {user?.role === "parent" && <Link to="/parent/messages" className="mobile-shortcut">
            <MessageIcon />{" " + uiT("留言给学校") + " "}<ChevronRight className="ml-auto h-4 w-4" />
          </Link>}
        {user?.role === "teacher" && <Link to="/teacher/messages" className="mobile-shortcut">
            <MessageIcon />{" " + uiT("留言给教务") + " "}<ChevronRight className="ml-auto h-4 w-4" />
          </Link>}
        {user?.role !== "admin" && <Link className="mobile-shortcut" to={user?.role === "teacher" ? "/teacher/letters" : "/parent/letters"}>{" " + uiT("查看站内会话") + " "}<ChevronRight className="ml-auto h-4 w-4" />
          </Link>}
        {!!unreadTotal && <Button variant="outline" disabled={mark.isPending} onClick={() => mark.mutate()}>
            <CheckCheck className="mr-2 h-4 w-4" />{" " + uiT("全部标为已读（")}{unreadTotal}）
          </Button>}
        {isLoading ? <Card className="p-6">{uiT("正在加载消息…")}</Card> : error ? <Card className="p-6">
            <p role="alert">{uiT("消息加载失败")}</p>
            <Button onClick={() => refetch()} variant="outline">{" " + uiT("重试") + " "}</Button>
          </Card> : !shown.length ? <Card className="p-8 text-center text-gray-500 dark:text-gray-400 ">
            {items.length ? uiT("当前筛选下没有消息") : uiT("暂无消息")}
          </Card> : shown.map(item => <Card key={item.id} className={`p-4 ${!item.read ? "border-primary-200 dark:border-primary-800 " : ""}`}>
              <div className="flex items-start gap-3">
                {!item.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500" aria-label={uiT("未读")} />}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{item.title}</h2>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-gray-500 dark:text-gray-400 ">
                    {item.body}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400 ">
                      {relativeTime(item.created_at)}
                    </span>
                    {!item.read && <Button variant="ghost" size="sm" disabled={mark.isPending} onClick={() => mark.mutate([item.id])}>{" " + uiT("标为已读") + " "}</Button>}
                  </div>
                  {item.link && <a className="mt-2 inline-block text-sm text-primary-700 underline dark:text-primary-300 " href={notificationLink(item.link, user?.role)}>{" " + uiT("查看详情") + " "}</a>}
                </div>
              </div>
            </Card>)}
      </main>
    </div>;
}
function MessageIcon() {
  useUiLanguage();
  return <Bell className="h-5 w-5 text-primary-700 dark:text-primary-300 " />;
}
