import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { useAuth } from "../auth/useAuth.js";
import { useSchedule } from "./useSchedule.js";
import { analyzeSchedule, DEFAULT_LOAD_LIMITS, inputToIso, schoolInput, schoolWeekWindow } from "./scheduleInsights.js";
const when = iso => new Date(iso).toLocaleString(uiLocale(), {
  timeZone: "Asia/Shanghai",
  hour12: false
});
export default function RescheduleDialog({
  lesson,
  proposedAt,
  teacherId,
  teacherName,
  studentId,
  studentName,
  limits = DEFAULT_LOAD_LIMITS,
  onClose,
  onSaved,
  layer = 0
}) {
  useUiLanguage();
  const {
    user
  } = useAuth();
  const admin = user?.role === "admin";
  const [value, setValue] = useState(schoolInput(proposedAt || lesson.scheduled_at));
  const [minutes, setMinutes] = useState(Number(lesson.duration_min || 60));
  const iso = inputToIso(value);
  const valid = !!iso && Number.isInteger(Number(minutes)) && Number(minutes) > 0 && Number(minutes) <= 1440;
  const candidateWindow = useMemo(() => iso ? schoolWeekWindow(iso) : {}, [iso, uiLocale()]);
  const {
    data: candidates = [],
    isLoading,
    error: checkError
  } = useSchedule({
    ...candidateWindow,
    enabled: valid
  });
  const next = {
    ...lesson,
    scheduled_at: iso,
    duration_min: Number(minutes),
    teacher_id: teacherId || lesson.teacher_id,
    student_id: studentId || lesson.student_id,
    profiles: {
      full_name: teacherName || lesson.profiles?.full_name
    },
    students: {
      full_name: studentName || lesson.students?.full_name
    }
  };
  const inspected = valid ? analyzeSchedule([...candidates.filter(row => row.id !== lesson.id), next], limits) : {
    conflicts: [],
    warnings: []
  };
  const conflicts = inspected.conflicts.filter(pair => pair.first.id === lesson.id || pair.second.id === lesson.id);
  const warnings = inspected.warnings.filter(warning => warning.lessonIds.includes(lesson.id));
  const unchanged = iso && Date.parse(iso) === Date.parse(lesson.scheduled_at) && Number(minutes) === Number(lesson.duration_min || 60) && next.teacher_id === lesson.teacher_id && next.student_id === lesson.student_id;
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const expanded = next.teacher_id !== lesson.teacher_id || next.student_id !== lesson.student_id || Number(minutes) !== Number(lesson.duration_min || 60);
      return http(`/${expanded ? "schedules" : "lessons"}/${lesson.id}`, {
        method: "PATCH",
        body: {
          scheduled_at: iso,
          ...(expanded ? {
            duration_min: Number(minutes),
            teacher_id: next.teacher_id,
            student_id: next.student_id
          } : {})
        }
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["schedules"]
      });
      qc.invalidateQueries({
        queryKey: ["lesson-detail"]
      });
      qc.invalidateQueries({
        queryKey: ["parent-upcoming"]
      });
      onSaved?.();
      onClose();
    }
  });
  const submit = event => {
    event.preventDefault();
    if (valid && !unchanged && !conflicts.length && !save.isPending && !isLoading) save.mutate();
  };
  const updateTime = event => {
    setValue(event.currentTarget.value);
    save.reset();
  };
  return <Dialog open onClose={save.isPending ? () => {} : onClose} title={uiT("确认调课")} layer={layer} description={uiT("先核对安排，再确认保存")} footer={<>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{" " + uiT("放弃调整") + " "}</Button>
          <Button type="submit" form="confirm-reschedule" disabled={!valid || !!unchanged || conflicts.length > 0 || save.isPending || isLoading}>
            {save.isPending ? uiT("保存中…") : uiT("确认调课")}
          </Button>
        </>}>
      <form id="confirm-reschedule" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="font-medium">
            {lesson.students?.full_name || uiT("学员")} · {lesson.profiles?.full_name || uiT("老师")}
          </p>
          <p className="mt-1 text-gray-500 dark:text-gray-400 ">{" " + uiT("原安排（北京时间）：")}{when(lesson.scheduled_at)} · {lesson.duration_min || 60}{" " + uiT("分钟") + " "}</p>
        </div>
        <div>
          <Label htmlFor="confirm-at">{uiT("新上课时间（北京时间）")}</Label>
          <Input id="confirm-at" type="datetime-local" value={value} required disabled={save.isPending} onInput={updateTime} onChange={updateTime} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="confirm-duration">{uiT("课程时长（分钟）")}</Label>
          <Input id="confirm-duration" type="number" min="1" max="1440" step="1" value={minutes} disabled={!admin || save.isPending} required onChange={event => {
          setMinutes(event.target.value);
          save.reset();
        }} className="mt-1.5" />
        </div>
        {valid && <p className="text-sm">{" " + uiT("预计结束：")}{when(new Date(Date.parse(iso) + Number(minutes) * 60000).toISOString())}
          </p>}
        {next.teacher_id !== lesson.teacher_id && <p role="alert" className="text-sm text-warning-700 dark:text-warning-300 ">{" " + uiT("任课老师将调整为") + " "}{teacherName || teacherId}。
          </p>}
        {next.student_id !== lesson.student_id && <p role="alert" className="text-sm text-warning-700 dark:text-warning-300 ">{" " + uiT("学员将调整为") + " "}{studentName || studentId}{uiT("，请确认所选课程归属。") + " "}</p>}
        {!valid && <p role="alert" className="text-sm text-danger-700 dark:text-danger-300 ">{" " + uiT("请选择有效日期、时间及课程时长。") + " "}</p>}
        {isLoading && <p className="text-xs text-gray-500 dark:text-gray-400 ">{uiT("正在检查目标时段…")}</p>}
        {checkError && <p className="text-xs text-warning-700 dark:text-warning-300 ">{" " + uiT("预检查暂时不可用，保存时仍会由服务器校验冲突。") + " "}</p>}
        {conflicts.length > 0 && <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-300 ">{" " + uiT("该时间与已有课程重叠，请调整时间或老师。") + " "}</p>}
        {warnings.length > 0 && <div role="status" className="rounded-lg bg-warning-50 p-3 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-300 ">{" " + uiT("此安排触发")}{" "}
            {warnings.map(w => w.type === "consecutive" ? uiT("短间隔连堂") : w.type === "day" ? uiT("日课时上限") : uiT("周课时上限")).join("、")}{" "}{" " + uiT("提醒，可继续保存，建议核对休息安排。") + " "}</div>}
        {save.error && <p role="alert" className="text-sm text-danger-700 dark:text-danger-300 ">
            {save.error.message || uiT("调课失败，请重试")}
          </p>}
        <p className="text-xs text-gray-500 dark:text-gray-400 ">{" " + uiT("保存时会再次检查老师与学员的时间冲突；调课通知沿用系统现有通知流程。") + " "}</p>
      </form>
    </Dialog>;
}
