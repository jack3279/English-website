import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { uiT } from "../../i18n/store.js";
import { useAuth } from "../auth/useAuth.js";
import { useInstitution } from "../admin/InstitutionContext.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
export default function LessonCorrectionDialog({ lesson, onClose, onSaved }) {
  const { user } = useAuth(),
    { rules } = useInstitution(),
    qc = useQueryClient();
  const pending = lesson.correction?.state === "pending" ? lesson.correction.input : null;
  const reviewPending = lesson.absence_review_status === "pending" && user?.role === "admin";
  const [mode, setMode] = useState(
      pending?.mode || (reviewPending || !lesson.record ? "attendance" : "content"),
    ),
    [content, setContent] = useState(pending?.content ?? lesson.record?.content ?? ""),
    [result, setResult] = useState(
      pending?.result || (lesson.status === "no_show" ? "no_show" : "attended"),
    ),
    [deduct, setDeduct] = useState(
      pending?.deduct_hours ?? lesson.absence_deduct_hours ?? rules.absenceDeductHours ?? false,
    ),
    [payTeacher, setPayTeacher] = useState(
      pending?.pay_teacher ?? lesson.absence_pay_teacher ?? rules.absencePayTeacher ?? true,
    ),
    [reason, setReason] = useState(pending?.reason || (reviewPending ? "缺勤结算确认" : "")),
    [password, setPassword] = useState("");
  const attempt = useRef(null);
  const [requestId, setRequestId] = useState(pending?.request_id || crypto.randomUUID());
  const preview = useQuery({
    queryKey: ["correction-preview", lesson.id, mode, result, deduct, payTeacher],
    queryFn: async () =>
      (
        await http(`/lessons/${lesson.id}/correction-preview`, {
          method: "POST",
          body: { mode, result, deduct_hours: deduct, pay_teacher: payTeacher },
        })
      ).data,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const original = pending || preview.data?.pending;
      const payload = attempt.current || {
        mode,
        request_id: requestId,
        content: content.trim(),
        expected_hash: original?.expected_hash || preview.data.expected_hash,
        reason: reason.trim(),
        ...(mode === "attendance" ? { result, deduct_hours: deduct, pay_teacher: payTeacher } : {}),
      };
      attempt.current = payload;
      return http(`/lessons/${lesson.id}/correction`, {
        method: "PATCH",
        body: {
          ...payload,
          ...(payload.mode === "attendance" ? { current_password: password } : {}),
        },
      });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["lesson-detail", lesson.id] });
      qc.invalidateQueries({ queryKey: ["correction-preview", lesson.id] });
    },
    onSuccess: async () => {
      setPassword("");
      for (const key of [
        "schedules",
        "lesson-detail",
        "students",
        "student",
        "student-hour-ledger",
        "parent-feeds",
        "reports",
        "operations",
        "payroll",
        "teacher-home-payroll",
        "finance",
        "alerts",
        "my-students",
      ])
        await qc.invalidateQueries({ queryKey: [key] });
      onSaved();
      onClose();
    },
  });
  const p = preview.data;
  const locked = !!pending || !!p?.pending || !!attempt.current;
  useEffect(() => {
    if (p?.pending && !attempt.current) {
      const v = p.pending;
      setRequestId(v.request_id);
      setMode(v.mode);
      setContent(v.content);
      setResult(v.result || result);
      setDeduct(v.deduct_hours ?? deduct);
      setPayTeacher(v.pay_teacher ?? payTeacher);
      setReason(v.reason || "");
    }
  }, [p]);
  return (
    <Dialog
      open
      title={uiT(reviewPending ? "确认缺勤结算" : "更正上课记录")}
      onClose={onClose}
      layer={1}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {uiT("取消")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              preview.isPending ||
              preview.isError ||
              !content.trim() ||
              (mode === "attendance" && (!password || reason.trim().length < 2))
            }
          >
            {uiT(mutation.isPending ? "提交中…" : reviewPending ? "确认结算" : "确认更正")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(pending || p?.pending || attempt.current) && (
          <p role="status">{uiT("上一笔更正尚未完成，请保持原内容重试。")}</p>
        )}
        {!reviewPending && !lesson.history_settled &&
          user?.role === "admin" &&
          ["completed", "no_show"].includes(lesson.status) && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mode === "attendance"}
                disabled={locked || mutation.isPending}
                onChange={(e) => setMode(e.target.checked ? "attendance" : "content")}
              />
              {uiT("同时更正点名与结算")}
            </label>
          )}
        {mode === "attendance" && (
          <>
            {!reviewPending && (
              <div className="flex gap-2">
                {[
                  ["attended", "上课"],
                  ["no_show", "缺勤"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    variant={result === value ? "default" : "outline"}
                    disabled={locked || mutation.isPending}
                    onClick={() => setResult(value)}
                  >
                    {uiT(label)}
                  </Button>
                ))}
              </div>
            )}
            {result === "no_show" && (
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={deduct}
                  disabled={locked || mutation.isPending}
                  onChange={(e) => setDeduct(e.target.checked)}
                />
                {uiT("缺勤扣课时")}
              </label>
            )}
            {result === "no_show" && (
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={payTeacher}
                  disabled={locked || mutation.isPending}
                  onChange={(e) => setPayTeacher(e.target.checked)}
                />
                {uiT("本节缺勤计教师课酬")}
              </label>
            )}
            {p && (
              <div className="rounded-lg border p-3 text-sm dark:border-gray-700">
                <p>{uiT("课时余额变动：{0} 小时", [p.hour_change])}</p>
                <p>{uiT("教师课酬：{0} → {1} {2}", [p.pay_before, p.pay_after, p.currency])}</p>
                <p>
                  {uiT(
                    reviewPending
                      ? "确认后按以上选择结算，不会重复扣课或计酬。"
                      : "原流水保留，更正使用调整流水，不重复扣课。",
                  )}
                </p>
              </div>
            )}
            <label className="block">
              {uiT(reviewPending ? "确认说明" : "更正原因")}
              <Textarea
                value={reason}
                readOnly={locked}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="block">
              {uiT("当前管理员密码")}
              <input
                type="password"
                className="mt-1 w-full rounded border bg-transparent p-2 dark:border-gray-700"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="block">
          {uiT("本节课上课内容")}
          <Textarea
            aria-label={uiT("本节课上课内容")}
            value={content}
            readOnly={locked}
            maxLength={5000}
            rows={4}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        {mode === "content" && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {uiT("仅修改上课内容，并同步已发布的家长记录；课时和教师课酬不变。")}
          </p>
        )}
        {(preview.error || mutation.error) && (
          <p role="alert" className="text-red-600 dark:text-red-300">
            {(mutation.error || preview.error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
