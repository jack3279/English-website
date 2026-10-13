import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "admin", "stats"],
    queryFn: async () => {
      // 后端暂没 stats 端点, 临时用现有 endpoints 拼
      const [schedules, students] = await Promise.all([
        http(
          "/schedules?from=" +
            new Date().toISOString().split("T")[0] +
            "&to=" +
            new Date().toISOString().split("T")[0],
        ),
        http("/students?pageSize=100"),
      ]);
      return {
        todayLessons: schedules.data?.length || 0,
        todayCompleted: schedules.data?.filter((l) => l.status === "completed").length || 0,
        activeStudents: students.data?.filter((s) => s.status === "active").length || 0,
        lowBalance: students.data?.filter((s) => (s.remaining_hours ?? 0) < 3).length || 0,
      };
    },
    refetchInterval: 60000,
  });
}
