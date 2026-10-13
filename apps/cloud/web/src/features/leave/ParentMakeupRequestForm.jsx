import { useState } from "react";
import { useCreateMakeup } from "./useLeave.js";
import { useSchedule } from "../schedule/useSchedule.js";
import { inputToIso } from "../schedule/scheduleInsights.js";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Select } from "../../components/ui/select.jsx";
export default function ParentMakeupRequestForm() {
  const [open, setOpen] = useState(false),
    [lessonId, setLessonId] = useState(""),
    [when, setWhen] = useState(""),
    [note, setNote] = useState(""),
    [success, setSuccess] = useState(false);
  const [window] = useState(() => ({
    from: new Date(Date.now() - 180 * 86400000).toISOString(),
    to: new Date().toISOString(),
  }));
  const lessons = useSchedule({ ...window, statuses: ["cancelled", "no_show"], enabled: open });
  const create = useCreateMakeup();
  const rows = Array.isArray(lessons.data) ? lessons.data : [];
  async function submit(e) {
    e.preventDefault();
    const lesson = rows.find((l) => l.id === lessonId);
    if (!lesson) return;
    await create.mutateAsync({
      original_lesson_id: lessonId,
      student_id: lesson.student_id,
      scheduled_at: when ? inputToIso(when) : null,
      note: note.trim(),
    });
    setSuccess(true);
    setOpen(false);
    setNote("");
    setWhen("");
    setLessonId("");
  }
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">申请补课</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            选择已取消或缺席的课程，告诉教务希望的时间。申请不会自动排课或增减课时。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setOpen(!open);
            setSuccess(false);
          }}
        >
          {" "}
          {open ? "收起" : "申请补课"}{" "}
        </Button>
      </div>
      {success && (
        <p role="status" className="text-sm text-success-700 dark:text-success-300">
          补课需求已提交，请等待教务安排并查看下方状态。
        </p>
      )}
      {open && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            submit(e).catch(() => {});
          }}
        >
          {lessons.isPending ? (
            <p>正在读取可申请的课程…</p>
          ) : lessons.isError ? (
            <p role="alert">
              课程读取失败。
              <button type="button" className="underline" onClick={() => lessons.refetch()}>
                重试
              </button>
            </p>
          ) : (
            <>
              <Label htmlFor="makeup-original">需要补课的课程</Label>
              <Select
                id="makeup-original"
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
                required
              >
                <option value="">请选择课程</option>
                {rows.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.students?.full_name || "孩子"} ·{" "}
                    {new Date(l.scheduled_at).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour12: false,
                    })}{" "}
                    · {l.status === "no_show" ? "缺席" : "已取消"}
                  </option>
                ))}
              </Select>
              {!rows.length && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  近180天没有可申请补课的课程。如课程尚未取消，请先提交请假申请。
                </p>
              )}
            </>
          )}
          <Label htmlFor="makeup-preferred">希望补课时间（选填，北京时间）</Label>
          <Input
            id="makeup-preferred"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <Label htmlFor="makeup-request-note">补课需求说明</Label>
          <Textarea
            id="makeup-request-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            required
            placeholder="例如：希望周六上午补课，其余时间也可沟通"
          />
          {create.error && (
            <p role="alert" className="text-danger-600 dark:text-danger-300">
              {create.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={
              create.isPending ||
              lessons.isPending ||
              lessons.isError ||
              !lessonId ||
              !note.trim() ||
              (!!when && !inputToIso(when))
            }
          >
            {create.isPending ? "正在提交…" : "提交补课需求"}
          </Button>
        </form>
      )}
    </Card>
  );
}
