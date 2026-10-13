import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";

export function useParentFeed(limit = 5) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dashboard", "parent", "feed", user?.id, limit],
    queryFn: async () => {
      // 拉 parent 绑的学员 + 这些学员的最近反馈
      const studentsR = await http("/students?pageSize=50");
      const students = studentsR.data || [];
      const allFeeds = [];
      for (const s of students) {
        const r = await http("/parent/feeds?studentId=" + s.id + "&pageSize=3");
        (r.data || []).forEach((f) => allFeeds.push({ ...f, student_name: s.full_name }));
      }
      allFeeds.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      return allFeeds.slice(0, limit);
    },
    enabled: !!user,
  });
}
