import { useAuth } from "../auth/useAuth.js";
import HistoryLessonModal from './HistoryLessonModal.jsx';
import { useSearchParams } from "react-router-dom";
import LessonDetailModal from "../schedule/LessonDetailModal.jsx";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NotebookPen, Download } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../../components/ui/table.jsx";
import { useSchedule } from "../schedule/useSchedule.js";
import { schoolDay } from "../schedule/scheduleInsights.js";
import { downloadCsv } from "../../lib/csv.js";
import { schoolPeriod } from "../../lib/schoolPeriod.js";
const labels = () => ({
  scheduled: uiT("待上课"),
  completed: uiT("上课"),
  no_show: uiT("缺勤"),
  leave: uiT("请假"),
  cancelled: uiT("已取消"),
});
export default function ClassRecordsPage() {
  useUiLanguage();
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const reviewOnly = search.get("review") === "pending";
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [range, setRange] = useState("30"),
    [status, setStatus] = useState("all");
  const window = useMemo(() => {
    const dates = schoolPeriod(range);
    return {
      from: dates.from ? new Date(`${dates.from}T00:00:00+08:00`).toISOString() : undefined,
      to: dates.to ? new Date(`${dates.to}T23:59:59+08:00`).toISOString() : undefined,
    };
  }, [range, uiLocale()]);
  const query = useSchedule({
      ...(reviewOnly ? { absenceReview: "pending" } : window),
      includeRecords: true,
    }),
    all = query.data || [];
  const rows = all.filter(
    (l) =>
      status === "all" ||
      (status === "leave" ? l.leave_status === "approved" : l.status === status),
  );
  const completed = all.filter((l) => l.status === "completed").length,
    absent = all.filter((l) => l.status === "no_show").length;
  const recorded = completed + absent;
  const attendance = recorded ? ((completed / recorded) * 100).toFixed(1) + "%" : "—";
  function exportRows() {
    downloadCsv(
      uiT("上课记录.csv"),
      [
        uiT("时间（北京时间）"),
        uiT("学员"),
        uiT("教师"),
        uiT("时长（分钟）"),
        uiT("状态"),
        uiT("本节课上课内容"),
        uiT('记录类型'),
      ],
      rows.map((l) => [
        new Date(l.scheduled_at).toLocaleString(uiLocale(), {
          timeZone: "Asia/Shanghai",
        }),
        l.students?.full_name || "",
        l.profiles?.full_name || "",
        l.duration_min,
        l.leave_status === "approved" ? uiT("请假") : labels()[l.status] || l.status,
        l.lesson_content || "",
        l.history_settled ? uiT('历史已结清') : uiT('正常课程'),
      ]),
    );
  }
  return (
    <div>
      <PageHeader
        icon={NotebookPen}
        title={uiT("上课记录")}
        subtitle={uiT("出勤与完课记录 · 北京时间")}
        actions={
          <div className="flex gap-2">{user?.role==='admin'&&<Button onClick={()=>setHistoryOpen(true)}>补录历史课程</Button>}<Button variant="outline" disabled={!rows.length} onClick={exportRows}>
            <Download className="mr-2 h-4 w-4" />
            {" " + uiT("导出记录") + " "}
          </Button></div>
        }
      />
      {reviewOnly && (
        <div className="px-4 py-2 text-sm text-warning-800 dark:text-warning-200">
          缺勤结算待确认{" "}
          <Button variant="outline" size="sm" onClick={() => setSearch({})}>
            查看全部记录
          </Button>
        </div>
      )}
      <main className="page-body space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [uiT("区间课次"), all.length],
            [uiT("已完成"), completed],
            [uiT("缺席"), absent],
            [uiT("已登记课程出勤率"), attendance],
          ].map(([name, value]) => (
            <Card className="p-5" key={name}>
              <p className="text-sm text-gray-500 dark:text-gray-400">{name}</p>
              <p className="mt-2 text-2xl font-semibold">
                {query.isPending ? "…" : query.isError ? "—" : value}
              </p>
            </Card>
          ))}
        </div>
        <Card className="flex flex-wrap gap-3 p-4">
          <Segmented
            value={range}
            onChange={setRange}
            items={[
              {
                key: "7",
                label: uiT("近7天"),
              },
              {
                key: "30",
                label: uiT("近30天"),
              },
              {
                key: "90",
                label: uiT("近90天"),
              },
              {key:'all',label:uiT('全部历史')},
            ]}
          />
          <Segmented
            value={status}
            onChange={setStatus}
            items={[
              {
                key: "all",
                label: uiT("全部"),
              },
              ...Object.entries(labels()).map(([key, label]) => ({
                key,
                label,
              })),
            ]}
          />
        </Card>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {" " +
            uiT(
              "出勤率按已登记的已完成 /（已完成 + 缺席）计算；待上课和取消课节不计入。点名结果和本节课内容在本页查看。",
            ) +
            " "}
        </p>
        <Card>
          {all.some((l) => l.schedule_list_truncated) && (
            <p className="p-3 text-sm text-warning-700 dark:text-warning-300">
              {uiT("仅显示最近500条课程，请缩小日期范围查看更完整记录。")}
            </p>
          )}
          {query.isError ? (
            <div className="p-6" role="alert">
              {" " + uiT("记录加载失败")}{" "}
              <Button onClick={() => query.refetch()} variant="outline">
                {" " + uiT("重试") + " "}
              </Button>
            </div>
          ) : query.isPending ? (
            <p className="p-6">{uiT("正在读取记录…")}</p>
          ) : !rows.length ? (
            <p className="p-6 text-gray-500 dark:text-gray-400">{uiT("当前条件下暂无课程记录")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    uiT("时间"),
                    uiT("学员"),
                    uiT("教师"),
                    uiT("时长"),
                    uiT("状态"),
                    uiT("本节课上课内容"),
                    uiT("档案"),
                  ].map((s) => (
                    <TableHead key={s}>{s}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {new Date(l.scheduled_at).toLocaleString(uiLocale(), {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </TableCell>
                    <TableCell>{l.students?.full_name || "—"}</TableCell>
                    <TableCell>{l.profiles?.full_name || "—"}</TableCell>
                    <TableCell>
                      {l.duration_min}
                      {" " + uiT("分钟")}
                    </TableCell>
                    <TableCell>
                      {l.history_settled ? `${l.leave_status==='approved'?uiT('请假'):labels()[l.status]||l.status} · ${uiT('历史已结清')}` : l.absence_review_status === "pending"
                        ? uiT("缺勤结算待确认")
                        : l.leave_status === "approved"
                          ? uiT("请假")
                          : labels()[l.status] || l.status}
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-pre-wrap break-words">
                        {l.lesson_content || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => setSelectedLesson(l.id)}>
                        {uiT(
                          user?.role === "admin" && l.absence_review_status === "pending"
                            ? "确认缺勤结算"
                            : "上课记录",
                        )}
                      </Button>
                      <Link
                        className="text-primary-700 dark:text-primary-300"
                        to={`/students/${l.student_id}`}
                      >
                        {" " + uiT("学员档案 ›") + " "}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
      {selectedLesson && (
        <LessonDetailModal lessonId={selectedLesson} onClose={() => setSelectedLesson(null)} />
      )}
      {historyOpen&&<HistoryLessonModal onClose={()=>setHistoryOpen(false)} onSaved={r=>{setHistoryOpen(false);setSelectedLesson(r.id);}}/>}
    </div>
  );
}
