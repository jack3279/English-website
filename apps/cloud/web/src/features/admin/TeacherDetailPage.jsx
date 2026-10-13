import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { http } from "../../lib/http.js";
import { useSchedule } from "../schedule/useSchedule.js";
import { financeRange } from "../../lib/financeWindow.js";
import { TeacherFormModal } from "./TeachersPage.jsx";
import { useToast } from "../../components/ui/toast.jsx";
export default function TeacherDetailPage() {
  const { id } = useParams(),
    qc = useQueryClient(),
    toast = useToast(),
    [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ["teachers", "list"],
    queryFn: async () => (await http("/teachers")).data || [],
  });
  const teacher = query.data?.find((t) => t.id === id),
    range = financeRange("this_month");
  const lessons = useSchedule({
    teacherId: teacher?.profile_id,
    from: `${range.from}T00:00:00+08:00`,
    to: `${range.to}T23:59:59+08:00`,
    enabled: !!teacher?.profile_id,
  });
  const payroll = useQuery({
    queryKey: ["teacher-detail-payroll", range.from, range.to],
    queryFn: async () =>
      (
        await http(
          `/finance/payroll/report?from=${range.from}&to=${range.to}&teacher_id=${teacher.profile_id}`,
        )
      ).data,
    enabled: !!teacher?.profile_id,
  });
  const save = useMutation({
    mutationFn: (body) => http(`/teachers/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teachers"] });
      qc.invalidateQueries({ queryKey: ["teacher-detail-payroll"] });
      setEditing(false);
    },
    onError: (e) => toast.error(e.message || "保存失败"),
  });
  const students = [
    ...new Map(
      (lessons.data || [])
        .filter((l) => l.student_id)
        .map((l) => [l.student_id, l.students?.full_name || "学员"]),
    ).entries(),
  ];
  const done = (lessons.data || []).filter((l) => l.status === "completed");
  const payByCurrency = (payroll.data?.rows || [])
    .filter((r) => r.teacher_id === teacher?.profile_id)
    .reduce(
      (out, r) => ({
        ...out,
        [r.pay_currency]: (out[r.pay_currency] || 0) + Number(r.pay_amount || 0),
      }),
      {},
    );
  return (
    <div>
      <PageHeader
        icon={GraduationCap}
        title={teacher?.full_name || "教师档案"}
        back="/admin/teachers"
        subtitle="教师资料 · 本月授课 · 课酬"
        actions={
          teacher && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              编辑档案
            </Button>
          )
        }
      />
      <main className="page-body space-y-5">
        {query.isPending ? (
          <Card className="p-6">正在读取档案…</Card>
        ) : query.isError ? (
          <Card className="p-6" role="alert">
            教师档案读取失败 <Button onClick={() => query.refetch()}>重试</Button>
          </Card>
        ) : !teacher ? (
          <Card className="p-6">教师档案不存在</Card>
        ) : (
          <>
            <section className="home-intro">
              <h2>{teacher.full_name}</h2>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <Badge variant={teacher.active ? "success" : "secondary"}>
                  {teacher.active ? "在职" : "停用"}
                </Badge>
                <span className="break-all">{teacher.email || "暂无邮箱"}</span>
                <span>{teacher.phone || "暂无电话"}</span>
              </div>
              <p className="mt-3 text-sm">
                {(teacher.specialties || []).join(" · ") || "暂未填写专长"}
              </p>
            </section>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                [
                  "课酬单价 / 小时",
                  `${teacher.hourly_pay ?? "—"} ${teacher.pay_currency || "PHP"}`,
                ],
                [
                  "本月已完成课次",
                  !teacher.profile_id
                    ? "—"
                    : lessons.isPending
                      ? "…"
                      : lessons.isError
                        ? "—"
                        : done.length,
                ],
                [
                  "本月已完成课时",
                  !teacher.profile_id || lessons.isError
                    ? "—"
                    : lessons.isPending
                      ? "…"
                      : done.reduce((n, l) => n + Number(l.duration_min || 0) / 60, 0).toFixed(2) +
                        " h",
                ],
                [
                  "本月应计课酬",
                  payroll.isPending
                    ? "…"
                    : payroll.isError
                      ? "—"
                      : Object.entries(payByCurrency)
                          .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
                          .join(" · ") || "0",
                ],
              ].map(([name, value]) => (
                <Card key={name} className="p-5">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{name}</p>
                  <p className="mt-2 break-words text-xl font-semibold tabular-nums">{value}</p>
                </Card>
              ))}
            </div>
            <div className="role-home-columns">
              <Card className="p-5">
                <h2 className="font-semibold">本月授课学员</h2>
                {lessons.isError ? (
                  <p className="mt-3 text-sm" role="alert">
                    课单读取失败{" "}
                    <Button variant="outline" onClick={() => lessons.refetch()}>
                      重试
                    </Button>
                  </p>
                ) : lessons.isPending ? (
                  <p className="mt-3">正在读取课单…</p>
                ) : !students.length ? (
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">本月暂未排课</p>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {students.map(([studentId, name]) => (
                      <Link
                        className="flex items-center justify-between py-3 text-sm text-primary-700 dark:text-primary-300"
                        key={studentId}
                        to={`/students/${studentId}`}
                      >
                        {name}
                        <span>学员档案 ›</span>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
              <Card className="p-5">
                <h2 className="font-semibold">结算与教学</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  只按已完成课程计算课酬，优先采用完课时保存的金额。修改当前单价不覆盖已保存的课酬；币种与学生收费分别核算。
                </p>
                <Link
                  className="mt-4 block text-sm text-primary-700 dark:text-primary-300"
                  to="/admin/payroll"
                >
                  查看结算记录 ›
                </Link>
                <Link
                  className="mt-3 block text-sm text-primary-700 dark:text-primary-300"
                  to="/schedule"
                >
                  查看完整课程表 ›
                </Link>
              </Card>
            </div>
          </>
        )}
      </main>
      {editing && teacher && (
        <TeacherFormModal
          initial={teacher}
          submitting={save.isPending}
          onSubmit={(body) => save.mutate(body)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
