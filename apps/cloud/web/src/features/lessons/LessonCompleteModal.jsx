import { useAuth } from "../auth/useAuth.js";
import { useState } from "react";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { useInstitution } from "../admin/InstitutionContext.jsx";
export default function LessonCompleteModal({
  lesson,
  onClose,
  onSubmit,
  submitting,
  presentation = "dialog",
  layer = 0,
}) {
  useUiLanguage();
  const { rules, loading: rulesLoading, error: rulesError } = useInstitution();
  const { user } = useAuth();
  const [result, setResult] = useState(lesson.roll_call?.input?.result || "attended"),
    [content, setContent] = useState(lesson.roll_call?.input?.content || ""),
    [reason, setReason] = useState(lesson.roll_call?.input?.reason || ""),
    [deductChoice, setDeduct] = useState(lesson.roll_call?.input?.deduct_hours ?? null);
  const deduct =
    lesson.roll_call?.state === "pending"
      ? (lesson.roll_call.input?.deduct_hours ?? false)
      : user?.role === "admin"
        ? (deductChoice ?? rules.absenceDeductHours ?? false)
        : false;
  const [payTeacher, setPayTeacher] = useState(
    lesson.roll_call?.input?.pay_teacher ?? rules.absencePayTeacher ?? true,
  );
  const locked = lesson.roll_call?.state === "pending";
  const needReason = result === "leave" || (result === "no_show" && deduct);
  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={submitting}>
        {uiT("取消")}
      </Button>
      <Button
        type="submit"
        form="lesson-complete-form"
        disabled={
          submitting ||
          rulesLoading ||
          !!rulesError ||
          !content.trim() ||
          (needReason && !reason.trim())
        }
      >
        {uiT(submitting ? "提交中…" : "保存点名及上课记录")}
      </Button>
    </>
  );
  const body = (
    <form
      id="lesson-complete-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          result,
          content: content.trim(),
          reason: reason.trim(),
          deduct_hours: result === "no_show" && deduct,
          ...(result === "no_show" && user?.role === "admin" ? { pay_teacher: payTeacher } : {}),
        });
      }}
    >
      <fieldset>
        <legend className="mb-2 font-medium">{uiT("点名结果")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["attended", "上课"],
            ["leave", "请假"],
            ["no_show", "缺勤"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={result === key}
              disabled={locked}
              onClick={() => setResult(key)}
              className={
                "rounded-lg border p-3 " +
                (result === key
                  ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900 dark:text-primary-100"
                  : "border-gray-300 dark:border-gray-700")
              }
            >
              {uiT(label)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-2">
        <span>{uiT("本节课上课内容")}</span>
        <Textarea
          required
          readOnly={locked}
          aria-label={uiT("本节课上课内容")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={4}
          placeholder={uiT("填写教材、页码或本节课内容；请假和缺勤填写原计划内容")}
        />
      </label>
      {result !== "attended" && (
        <label className="block space-y-2">
          <span>{uiT("原因")}</span>
          <Textarea
            aria-label={uiT("原因")}
            required={needReason}
            readOnly={locked}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
          />
        </label>
      )}
      {result === "no_show" && user?.role === "admin" && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={deduct}
            disabled={locked || user?.role !== "admin"}
            onChange={(e) => setDeduct(e.target.checked)}
          />
          {uiT("缺勤扣课时")}
        </label>
      )}
      {result === "no_show" && user?.role === "admin" && (
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={payTeacher}
            disabled={locked}
            onChange={(e) => setPayTeacher(e.target.checked)}
          />
          {uiT("本节缺勤计教师课酬")}
        </label>
      )}
      {rulesError && <p role="alert">{uiT("考勤规则读取失败，请刷新后重试。")}</p>}
      {result === 'leave' && <p className="text-sm text-amber-700 dark:text-amber-300">{uiT('仅截止前提交的请假有效；没有提前请假的，下课后按缺勤登记，结算由管理员确认。')}</p>}
      <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
        {uiT(
          result === "attended"
            ? "上课按课长扣课时并计算课酬。"
            : result === "leave"
              ? "请假不扣课时，不计教师课酬。"
              : user?.role === "admin"
                ? "管理员独立确认是否扣学生课时及是否计教师课酬。"
                : "缺勤登记后由管理员确认结算，暂不扣课时、暂不计课酬。",
        )}
      </p>
    </form>
  );
  const description = (
    <span>
      {lesson.students?.full_name} ·{" "}
      {new Date(lesson.scheduled_at).toLocaleString(uiLocale(), { timeZone: "Asia/Shanghai" })}
    </span>
  );
  return presentation === "page" ? (
    <section className="rounded-xl border bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      <p className="mb-4 text-sm text-gray-500">{description}</p>
      {body}
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-white py-3 dark:bg-gray-900">
        {footer}
      </div>
    </section>
  ) : (
    <Dialog
      open
      onClose={onClose}
      title={uiT("课程点名")}
      description={description}
      footer={footer}
      layer={layer}
    >
      {body}
    </Dialog>
  );
}
