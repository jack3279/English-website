import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "../../lib/http.js";
import { exportRowsToXlsx } from "../../lib/xlsx.js";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
const fmt = (v) =>
  v ? new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
export default function HourLedger({ studentId, studentName }) {
  const [page, setPage] = useState(0),
    [lessonId, setLessonId] = useState(null),
    [exportError, setExportError] = useState("");
  useEffect(() => {
    if (window.location.hash === "#hour-ledger")
      requestAnimationFrame(() =>
        document.getElementById("hour-ledger")?.scrollIntoView({ block: "start" }),
      );
  }, [studentId]);
  const query = useQuery({
    queryKey: ["student-hour-ledger", studentId],
    queryFn: async () => (await http(`/students/${studentId}/hour-ledger`)).data,
  });
  const lesson = useQuery({
    queryKey: ["lesson-detail", lessonId],
    queryFn: async () => (await http(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });
  const rows = query.data?.events || [];
  async function download() {
    try {
      await exportRowsToXlsx("学生课时账单.xlsx", "课时明细", rows, {
        日期: (r) => fmt(r.at),
        项目: "label",
        课时变化: "delta",
        说明: "note",
        有效期: (r) => (r.expires_at ? fmt(r.expires_at) : ""),
        课节编号: "lesson_id",
      });
    } catch (e) {
      setExportError(e.message || "导出失败");
    }
  }
  return (
    <Card id="hour-ledger" className="p-4 space-y-3">
      <div className="flex justify-between items-center gap-3">
        <h3 className="font-semibold">课时账单</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isPending || query.isError || !rows.length}
          onClick={download}
        >
          导出 Excel
        </Button>
      </div>
      {query.isPending ? (
        <p>正在读取课时账单…</p>
      ) : query.isError ? (
        <p role="alert">
          课时账单读取失败。
          <Button variant="outline" onClick={() => query.refetch()}>
            重试
          </Button>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
            {[
              ["购入", query.data?.summary?.purchased_hours],
              ["上课及缺席消耗", query.data?.summary?.consumed_hours],
              ["退还", query.data?.summary?.refunded_hours],
              ["调整", query.data?.summary?.adjusted_hours],
              ["当前剩余", query.data?.remaining_hours],
            ].map(([name, value]) => (
              <div key={name} className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">{name}</p>
                <strong>{value ?? "—"} 小时</strong>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            余额以实际课时账户为准。扣课、退款和调整分别留痕；缺席扣课会明确注明。课时包有效期请查看上方课时包。
          </p>
          {!rows.length ? (
            <p className="text-sm">暂无课时记录。</p>
          ) : (
            rows.slice(page * 15, page * 15 + 15).map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-800 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.label} ·{" "}
                    {r.delta == null ? "不计入余额" : `${r.delta > 0 ? "+" : ""}${r.delta}小时`}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{fmt(r.at)}</p>
                  <p className="break-words text-gray-600 dark:text-gray-400">{r.note}</p>
                </div>
                {r.lesson_id && (
                  <Button size="sm" variant="outline" onClick={() => setLessonId(r.lesson_id)}>
                    上课记录
                  </Button>
                )}
              </div>
            ))
          )}
          {rows.length > 15 && (
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-xs">
                {page + 1} / {Math.ceil(rows.length / 15)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 15 >= rows.length}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
      {exportError && <p role="alert">{exportError}</p>}
      {lessonId && (
        <Dialog open title="上课记录" onClose={() => setLessonId(null)}>
          <div className="space-y-3 text-sm">
            {lesson.isPending ? (
              "正在读取…"
            ) : lesson.isError ? (
              <p role="alert">上课记录读取失败。</p>
            ) : (
              <>
                <p>
                  {fmt(lesson.data?.scheduled_at)} · {lesson.data?.duration_min}分钟
                </p>
                <p>
                  状态：
                  {{
                    completed: "已完课",
                    no_show: "缺席",
                    cancelled: "已取消",
                    scheduled: "待上课",
                  }[lesson.data?.status] || lesson.data?.status}
                </p>
                {lesson.data?.attendance && (
                  <p>
                    缺席处理：
                    {lesson.data.attendance.state === "pending"
                      ? "登记待确认，请联系教务核对实际流水"
                      : lesson.data.attendance.result?.deducted_hours
                        ? `扣除${lesson.data.attendance.result.deducted_hours}小时`
                        : "不扣课时"}{" "}
                    · {lesson.data.attendance.choice?.reason}
                  </p>
                )}
                {lesson.data?.record ? (
                  <>
                    <p>课堂内容：{lesson.data.record.content}</p>
                    <p>课堂表现：{lesson.data.record.performance || "—"}</p>
                    <p>课后作业：{lesson.data.record.homework || "—"}</p>
                  </>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">暂无已发布的课堂反馈。</p>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}
    </Card>
  );
}
