import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Check, X, Calendar, MessageSquare, BookOpen } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { useState } from "react";

const STATUS_LABEL = {
  pending: { label: "待审批", tone: "warning" },
  approved: { label: "已批准", tone: "success" },
  rejected: { label: "已拒绝", tone: "destructive" },
};

function relativeTime(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3600000);
  if (h < 1) return "刚刚";
  if (h < 24) return `${h} 小时前`;
  return Math.floor(h / 24) + " 天前";
}

export default function LeaveManagePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [reviewing, setReviewing] = useState(null);

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ["admin", "leaves", filter],
    queryFn: async () => {
      // 接口返回 { items, total }，不是数组 —— 之前直接返回 r.data，
      // 下面 leaves.map 会因对象没有 map 而整页崩溃。
      const r = await http(`/leave?status=${filter}&limit=50`);
      return r.data?.items ?? [];
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, status, note }) =>
      http(`/leave/${id}/review`, { method: "POST", body: { status, note } }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "leaves"] });
      setReviewing(null);
      toast.success(`已${vars.status === "approved" ? "批准" : "拒绝"}请假`);
    },
    onError: (e) => toast.error(e?.message || "操作失败"),
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      <PageHeader
        icon={Calendar}
        title="请假审批"
        subtitle={`共 ${leaves.length} 条 · ${filter === "pending" ? "待审批" : filter === "approved" ? "已批准" : "已拒绝"}`}
      />

      <main className="page-body space-y-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          items={[
            { key: "pending", label: "待审批" },
            { key: "approved", label: "已批准" },
            { key: "rejected", label: "已拒绝" },
          ]}
        />

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">加载中…</Card>
        ) : leaves.length === 0 ? (
          <Card className="p-12 text-center">
            <Calendar className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-400 mb-2" />
            <div className="text-sm text-gray-500 dark:text-gray-400">
              没有{filter === "pending" ? "待审批" : filter === "approved" ? "已批准" : "已拒绝"}
              的请假
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {leaves.map((l) => {
              const status = STATUS_LABEL[l.status] || STATUS_LABEL.pending;
              return (
                <Card key={l.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {l.student_name || l.student_id?.slice(0, 8) || "学生"}
                        </span>
                        <Badge variant={status.tone}>{status.label}</Badge>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {relativeTime(l.created_at)}
                        </span>
                        {l.lesson_id && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            · 课次 {l.lesson_id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                      {l.reason && (
                        <div className="mt-2 flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                          <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span className="whitespace-pre-wrap">{l.reason}</span>
                        </div>
                      )}
                      {l.review_note && (
                        <div className="mt-2 flex items-start gap-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2.5 py-1.5">
                          <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>审批意见: {l.review_note}</span>
                        </div>
                      )}
                      {l.reviewed_by && (
                        <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                          审批人: {l.reviewed_by.slice(0, 8)} ·{" "}
                          {l.reviewed_at && relativeTime(l.reviewed_at)}
                        </div>
                      )}
                    </div>
                    {l.status === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setReviewing({ ...l, status: "rejected" })}
                        >
                          <X className="w-3.5 h-3.5 mr-1" /> 拒绝
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setReviewing({ ...l, status: "approved" })}
                        >
                          <Check className="w-3.5 h-3.5 mr-1" /> 批准
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {reviewing && (
        <ReviewDialog
          leave={reviewing}
          onClose={() => setReviewing(null)}
          onSubmit={(note) => review.mutate({ id: reviewing.id, status: reviewing.status, note })}
          submitting={review.isPending}
        />
      )}
    </div>
  );
}

function ReviewDialog({ leave, onClose, onSubmit, submitting }) {
  const [note, setNote] = useState("");
  const statusLabel = leave.status === "approved" ? "批准" : "拒绝";
  const tone = leave.status === "approved" ? "success" : "destructive";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(note.trim() || null);
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4 border border-gray-200 dark:border-gray-800"
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          确认{statusLabel}请假
        </h2>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <div>学生: {leave.student_name || leave.student_id}</div>
          {leave.reason && <div className="mt-1">原因: {leave.reason}</div>}
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="leave-review-note"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            审批意见 (可选)
          </label>
          <Textarea
            id="leave-review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="如: 已通知老师调整时间"
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            variant={tone === "success" ? "default" : "destructive"}
          >
            {submitting ? "处理中..." : `确认${statusLabel}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
