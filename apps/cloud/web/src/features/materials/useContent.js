import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";

export const ANN_KEY = ["announcements"];
export const MAT_KEY = ["materials"];

export function useAnnouncements() {
  return useQuery({
    queryKey: ANN_KEY,
    queryFn: async () => {
      const res = await http("/announcements");
      return res?.data ?? { items: [], total: 0 };
    },
    staleTime: 60000,
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b) => http("/announcements", { method: "POST", body: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANN_KEY }),
    onError: (e) => toast.error(e?.message || "发布公告失败"),
  });
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, ...patch }) =>
      http(`/announcements/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANN_KEY }),
    onError: (e) => toast.error(e?.message || "更新公告失败"),
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id) => http(`/announcements/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANN_KEY }),
    onError: (e) => toast.error(e?.message || "删除公告失败"),
  });
}

export function useMaterials(params) {
  const studentId = params?.studentId || "";
  return useQuery({
    queryKey: [...MAT_KEY, studentId],
    queryFn: async () => {
      const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
      const res = await http(`/materials${qs}`);
      return res?.data ?? { items: [], total: 0 };
    },
    staleTime: 60000,
  });
}

export function useCreateMaterial() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b) => http("/materials", { method: "POST", body: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MAT_KEY }),
    onError: (e) => toast.error(e?.message || "上传资料失败"),
  });
}

export function useDeleteMaterial() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id) => http(`/materials/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MAT_KEY }),
    onError: (e) => toast.error(e?.message || "删除资料失败"),
  });
}
