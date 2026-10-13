import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../../lib/supabase.js";

// Realtime 连不上时的兜底轮询间隔。
//
// 线上实测 Supabase Realtime 这条链路是"尽力而为"，有三处各自独立的前提，
// 任何一处不满足都会**静默收不到事件**（页面不报错，只是永远显示旧数据）：
//   ① 表必须加入 `supabase_realtime` 发布（parent_feeds / lessons 目前都没加）；
//   ② Supabase Realtime 会对 postgres_changes 应用 RLS，而家长端用的是 Worker
//      签发的 JWT、不是 Supabase 会话 —— 匿名身份看不到任何行；
//   ③ 前端需要正确的 VITE_SUPABASE_URL（曾回落到 127.0.0.1，连的是本机）。
// 所以不能把"数据会不会刷新"押在它身上：订阅成功就靠它即时刷新，
// 否则退回轮询。轮询只是一分钟一次的小请求，比"家长永远看不到新反馈"划算得多。
export const FALLBACK_POLL_MS = 60_000;

export function useRealtime(studentId) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!studentId) return undefined;
    let alive = true;
    let sb;
    let channel;
    try {
      sb = getSupabase();
      channel = sb
        .channel(`parent-h5:${studentId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "parent_feeds",
            filter: `student_id=eq.${studentId}`,
          },
          () => qc.invalidateQueries({ queryKey: ["parent-feeds", studentId] }),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lessons", filter: `student_id=eq.${studentId}` },
          () => qc.invalidateQueries({ queryKey: ["parent-upcoming"] }),
        )
        .subscribe((status) => {
          if (alive) setConnected(status === "SUBSCRIBED");
        });
    } catch {
      // 连加载都失败(如 URL 配错)时不能把页面带崩 —— 交给轮询兜底。
      if (alive) setConnected(false);
    }
    return () => {
      alive = false;
      if (sb && channel) sb.removeChannel(channel);
    };
  }, [studentId, qc]);

  // Socket 订阅成功不等于表发布和 RLS 授权有效。始终每分钟核对一次，事件只用于加速刷新。
  return { connected, refetchInterval: FALLBACK_POLL_MS };
}
