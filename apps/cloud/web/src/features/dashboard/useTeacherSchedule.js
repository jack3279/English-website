import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";

export function useTeacherSchedule() {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["dashboard", "teacher", "today", user?.id],
    queryFn: async () => {
      const r = await http("/schedules?from=" + today + "&to=" + today);
      return r.data || [];
    },
    enabled: !!user,
  });
}
