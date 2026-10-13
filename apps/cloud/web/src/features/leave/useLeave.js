import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { useToast } from "../../components/ui/toast.jsx";

export const LEAVE_KEY = ["leave"];
export const MAKEUP_KEY = ["makeups"];
// 铃铛用的通知列表 key（见 features/notifications/useNotifications.js）。
// 请假申请会触发后端给管理员发通知，所以要失效铃铛，否则角标不消。
export const NOTIFICATION_KEY = ["notifications"];
// 课表查询的真实 key 见 features/schedule/useSchedule.js —— 这里是 ["schedules", {...}]。
// 曾写成单数 "schedule" 与不存在的 "lessons"，导致审批请假后课表不刷新（只有 toast）。
export const SCHEDULE_KEY = ["schedules"];
export const LESSON_DETAIL_KEY = "lesson-detail";

export function useLeaveRequests(status) {
  return useQuery({
    queryKey: [...LEAVE_KEY, status ?? "all"],
    queryFn: async () => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await http(`/leave${qs}`);
      return res?.data ?? { items: [], total: 0 };
    },
    staleTime: 30000,
  });
}

export function useMakeups(status) {
  return useQuery({
    queryKey: [...MAKEUP_KEY, status ?? "all"],
    queryFn: async () => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      const res = await http(`/makeups${qs}`);
      return res?.data ?? { items: [], total: 0 };
    },
    staleTime: 30000,
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body) => http("/leave", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_KEY });
      qc.invalidateQueries({ queryKey: NOTIFICATION_KEY });
    },
    onError: (e) => toast.error(e?.message || "提交请假申请失败"),
  });
}

export function useReviewLeave() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, status, note }) =>
      http(`/leave/${id}/review`, { method: "POST", body: { status, note: note || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEAVE_KEY });
      qc.invalidateQueries({ queryKey: MAKEUP_KEY });
      qc.invalidateQueries({ queryKey: SCHEDULE_KEY });
      qc.invalidateQueries({ queryKey: ["operations", "todo"] });
    },
    onError: (e) => toast.error(e?.message || "审批失败"),
  });
}

export function useCreateMakeup() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body) => http("/makeups", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAKEUP_KEY });
      qc.invalidateQueries({ queryKey: NOTIFICATION_KEY });
      qc.invalidateQueries({ queryKey: SCHEDULE_KEY });
      qc.invalidateQueries({ queryKey: ["operations"] });
    },
    onError: (e) => toast.error(e?.message || "创建补课单失败"),
  });
}

export function usePatchMakeup() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, ...patch }) => http(`/makeups/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAKEUP_KEY });
      qc.invalidateQueries({ queryKey: SCHEDULE_KEY });
    },
    onError: (e) => toast.error(e?.message || "更新补课单失败"),
  });
}

// 家长自己名下的孩子 (后端已按角色过滤)
export function useMyStudents() {
  return useQuery({
    queryKey: ["my-students"],
    queryFn: async () => {
      const res = await http("/students?pageSize=50");
      return Array.isArray(res?.data) ? res.data : [];
    },
    staleTime: 120000,
  });
}

// 家长可见的待上课节 (用于请假时选具体哪节课)
export function useUpcomingLessons() {
  return useQuery({
    queryKey: ["parent-upcoming"],
    queryFn: async () => {
      const res = await http("/parent/lessons/upcoming");
      return Array.isArray(res?.data) ? res.data : [];
    },
    staleTime: 60000,
  });
}

// 老师名单 (排补课需要指定老师)
export function useTeachers(enabled = true) {
  return useQuery({
    queryKey: ["teachers"],
    enabled,
    queryFn: async () => {
      const res = await http("/teachers");
      return Array.isArray(res?.data) ? res.data : [];
    },
    staleTime: 300000,
  });
}
