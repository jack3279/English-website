import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";

export function useStudents({ page = 1, pageSize = 20, search = "" } = {}) {
  const term = search.trim();
  return useQuery({
    queryKey: ["students", { page, pageSize, term }],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (term) qs.set("search", term);
      return (await http(`/students?${qs}`)).data;
    },
  });
}

// 五个状态标签的准确计数（含搜索）。
export function useStudentStatusCounts(search = "") {
  const term = search.trim();
  return useQuery({
    queryKey: ["student-status-counts", term],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (term) qs.set("search", term);
      const suffix = qs.toString();
      return (await http(`/students/status-counts${suffix ? `?${suffix}` : ""}`)).data;
    },
  });
}

export function useStudent(id) {
  return useQuery({
    queryKey: ["student", id],
    queryFn: async () => (await http(`/students/${id}`)).data,
    enabled: !!id,
  });
}
