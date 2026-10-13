import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";

/**
 * 排课查询。
 *
 * enabled：可选，默认true。用来避免不需要时发请求。
 *   例：月视图只在 viewMode === "month" 时才查，否则每次进页面都多打一次全月请求。
 *
 * ⚠️ enabled刻意 **不进 queryKey**：
 *   同 from/to 的数据是同一份，enabled 只是"现在要不要发"，不是"查什么"。
 *   若放进 key，enabled 切换会把缓存切成另一份、invalidate 后还要再拉一次，徒增流量
 *   （Workers 出网 5GB/月，缓存分裂是要命的）。
 *   不进 key 时 invalidate 命中的是同一条缓存；enabled=false 的那条被标脏也不发请求，正好。
 */
export function useSchedule({
  from,
  to,
  teacherId,
  studentId,
  statuses,
  enabled,
  includeChanges = false,
  includeRecords = false,
  absenceReview,
} = {}) {
  const params = new URLSearchParams();
  if(absenceReview)params.set("absence_review",absenceReview);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (teacherId) params.set("teacherId", teacherId);
  if (studentId) params.set("studentId", studentId);
  if (includeRecords) params.set("includeRecords", "true");
  if (includeChanges) params.set("includeChanges", "true");
  if (statuses && statuses.length)
    params.set("statuses", Array.isArray(statuses) ? statuses.join(",") : String(statuses));
  return useQuery({
    queryKey: [
      "schedules",
      {
        from,
        to,
        teacherId,
        studentId,
        statuses: statuses || null,
        includeChanges,
        includeRecords,
        absenceReview,
      },
    ],
    queryFn: async () => (await http(`/schedules?${params}`)).data,
    enabled: enabled !== false,
  });
}
