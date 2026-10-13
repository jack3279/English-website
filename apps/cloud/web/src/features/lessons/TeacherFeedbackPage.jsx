import { useState } from "react";
import LessonCorrectionDialog from "./LessonCorrectionDialog.jsx";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { http } from "../../lib/http.js";
import { useAuth } from "../auth/useAuth.js";
import { useCompleteLesson } from "./useCompleteLesson.js";
import LessonCompleteModal from "./LessonCompleteModal.jsx";
export default function TeacherFeedbackPage() {
  useUiLanguage();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const { id } = useParams(),
    navigate = useNavigate(),
    { user } = useAuth();
  const query = useQuery({
    queryKey: ["lesson-detail", id],
    queryFn: async () => (await http(`/lessons/${id}`)).data,
  });
  const qc = useQueryClient();
  const publish = useMutation({
    mutationFn: () =>
      http(`/lessons/${id}/receipt`, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["lesson-detail", id],
      });
      qc.invalidateQueries({
        queryKey: ["operations"],
      });
      qc.invalidateQueries({
        queryKey: ["teacher-home-payroll"],
      });
      qc.invalidateQueries({
        queryKey: ["parent-feeds"],
      });
    },
  });
  const complete = useCompleteLesson(),
    lesson = query.data;
  const back = user?.role === "admin" ? "/schedule" : "/teacher/today";
  async function submit(payload) {
    try {
      await complete.mutateAsync({
        lessonId: id,
        studentId: lesson.student_id,
        payload,
      });
      navigate(back);
    } catch {}
  }
  const canComplete =
    (lesson?.status === "scheduled" || lesson?.roll_call?.state === "pending") &&
    (user?.role === "admin" || lesson.teacher_id === user?.id);
  return (
    <div>
      <PageHeader
        title={uiT("课程点名")}
        subtitle={uiT("点名并记录本节课内容，不需要课堂反馈")}
        icon={NotebookPen}
        back={back}
      />
      <main className="page-body">
        {query.isPending ? (
          <Card className="p-6">{uiT("正在读取课节…")}</Card>
        ) : query.isError ? (
          <Card className="p-6">
            <p role="alert">{uiT("课节读取失败")}</p>
            <Button onClick={() => query.refetch()} variant="outline">
              {" " + uiT("重试") + " "}
            </Button>
          </Card>
        ) : !canComplete ? (
          <Card className="p-6">
            <p>{uiT("该课节已有考勤结果，请查看上课记录。")}</p>
            {lesson?.status === "completed" &&
              (user?.role === "admin" || lesson.teacher_id === user?.id) && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm">
                    {uiT("已确认完课，发送上课记录不会再次扣课或更改课酬。")}
                  </p>
                  {lesson.record && (
                    <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                      {lesson.record.content}
                      {lesson.record.performance ? ` · ${lesson.record.performance}` : ""}
                    </p>
                  )}
                  {lesson.published ? (
                    <p className="text-success-700 dark:text-success-300">
                      {uiT("家长已可查看此记录。")}
                    </p>
                  ) : (
                    <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
                      {publish.isPending
                        ? uiT("正在发送…")
                        : lesson.record
                          ? uiT("发送现有记录给家长")
                          : uiT("发送简要上课确认")}
                    </Button>
                  )}
                  {publish.error && (
                    <p role="alert" className="text-danger-600 dark:text-danger-300">
                      {publish.error.message}
                    </p>
                  )}
                </div>
              )}
            {lesson.record && (user?.role === "admin" || lesson.teacher_id === user?.id) && (
              <div className="mt-4 space-y-3">
                {lesson.status !== "completed" && (
                  <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                    {lesson.record.content}
                  </p>
                )}
                <Button variant="outline" onClick={() => setCorrectionOpen(true)}>
                  {uiT("更正上课记录")}
                </Button>
              </div>
            )}
            <Link
              to="/admin/class-records"
              className="mt-3 inline-block text-primary-700 dark:text-primary-300"
            >
              {" " + uiT("查看上课记录 ›") + " "}
            </Link>
          </Card>
        ) : (
          <LessonCompleteModal
            presentation="page"
            lesson={lesson}
            onSubmit={submit}
            submitting={complete.isPending}
            onClose={() => navigate(back)}
          />
        )}
        {correctionOpen && (
          <LessonCorrectionDialog
            lesson={lesson}
            onClose={() => setCorrectionOpen(false)}
            onSaved={() => query.refetch()}
          />
        )}
      </main>
    </div>
  );
}
