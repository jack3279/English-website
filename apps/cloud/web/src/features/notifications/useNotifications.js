import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";

const KEY = ["notifications"];
// 角标专用的轻量 key。**故意与 KEY 分开**: 侧边栏角标只需要一个数字,
// 用 unread-count 就不必把 50 条通知正文拉回来(省子请求 + 带宽)。
// 注意别把 queryKey 写成单数 "notification" —— 那是本项目最隐蔽的一类 bug。
const COUNT_KEY = ["notifications", "unread-count"];

export function useUnreadCount({ enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: COUNT_KEY,
    queryFn: async () => {
      const res = await http("/notifications/unread-count");
      // 后端 ok(res, { count }) 会包一层成 { data: { count } }, http() 原样返回,
      // 所以这里是 res.data.count 而不是 res.count。超过 99 的收敛放组件里做,
      // 这里保持纯数字, 免得调用方拿到 "99+" 没法比较。
      return res?.data?.count ?? 0;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useNotifications({ enabled = true } = {}) {
  return useQuery({
    // 弹层没打开时 enabled=false：铃铛常驻顶栏，不加这个开关的话
    // 页面一加载就会去拉 50 条通知正文，只为可能永远不看的弹层。
    enabled,
    queryKey: KEY,
    queryFn: async () => {
      const res = await http("/notifications?limit=50");
      return res?.data ?? { items: [], unread: 0 };
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (ids) =>
      http("/notifications/read", { method: "POST", body: ids?.length ? { ids } : {} }),
    onSuccess: () => {
      // 两个 key 都要失效: 列表页要刷新已读态, 侧边栏角标要归零。
      // 漏掉 COUNT_KEY 的症状是「铃铛里已读为 0 但侧边栏红点还在」。
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: COUNT_KEY });
    },
    onError: (e) => toast.error(e?.message || "标记已读失败"),
  });
}
