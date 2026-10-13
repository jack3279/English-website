import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { Switch } from "../../components/ui/switch.jsx";
import { useToast } from "../../components/ui/toast.jsx";
const labels = () => ({
  lessons: uiT("课程与调课提醒"),
  feedback: uiT("课后反馈"),
  balance: uiT("课时不足"),
  leave: uiT("请假与补课"),
  messages: uiT("学校留言"),
  announcements: uiT("公告通知"),
  payroll: uiT("课酬登记通知"),
  backups: uiT("备份结果摘要")
});
export default function NotificationPreferences({
  role
}) {
  useUiLanguage();
  const qc = useQueryClient(),
    toast = useToast();
  const query = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => (await http("/me/preferences")).data
  });
  const save = useMutation({
    mutationFn: categories => http("/me/preferences", {
      method: "PATCH",
      body: {
        categories
      }
    }),
    onSuccess: r => {
      qc.setQueryData(["notification-preferences"], r.data);
      qc.invalidateQueries({
        queryKey: ["notifications"]
      });
    },
    onError: e => toast.error(e.message || uiT("通知设置保存失败"))
  });
  const keys = role === "parent" ? ["lessons", "feedback", "balance", "leave", "messages"] : role === "teacher" ? ["lessons", "leave", "payroll", "messages", "announcements"] : ["lessons", "balance", "leave", "messages", "backups"];
  return <section className="mt-4">
      <h3 className="text-sm font-semibold">{uiT("站内提醒偏好")}</h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{" " + uiT("关闭后不显示该分类的未读角标，消息仍保留在通知中心；微信助手提醒单独设置。") + " "}</p>
      {query.isError ? <p className="mt-3 text-sm text-danger-700 dark:text-danger-300" role="alert">{" " + uiT("偏好读取失败，暂不可修改。") + " "}</p> : <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {keys.map(key => <div className="flex items-center justify-between gap-3 py-3" key={key}>
              <span className="text-sm">{labels()[key]}</span>
              <Switch label={labels()[key]} checked={query.data?.categories?.[key] !== false} disabled={query.isPending || save.isPending || query.data?.storageReady === false} onChange={checked => save.mutate({
          [key]: checked
        })} />
            </div>)}
        </div>}
    </section>;
}
