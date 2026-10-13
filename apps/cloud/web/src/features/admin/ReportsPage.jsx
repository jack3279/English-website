import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FileText, Calendar, User, GraduationCap, Clock, Eye, EyeOff, Search, FileDown, Send } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { exportRowsToXlsx } from "../../lib/xlsx.js";

// 本机构所有课程都是一对一, 所以「课堂报告」= 单个学员某一节课的课后反馈。
// 管理员比家长多看一类: 老师写了但**没点发布**的草稿 —— 那是抽查教学质量的主要对象。
const PUBLISHED_FILTERS = () => [{
  key: "all",
  label: uiT("全部")
}, {
  key: "yes",
  label: uiT("已发布")
}, {
  key: "no",
  label: uiT("仅草稿")
}];
const RANGES = () => [{
  key: "7",
  label: uiT("近 7 天")
}, {
  key: "30",
  label: uiT("近 30 天")
}, {
  key: "all",
  label: uiT("全部")
}];
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(uiLocale(), {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
function Field({
  label,
  value,
  icon: Icon
}) {
  useUiLanguage();
  if (!value) return null;
  return <div className="flex gap-2">
      {Icon && <Icon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}：</span>
        <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
          {value}
        </span>
      </div>
    </div>;
}
function ReportCard({
  r,
  onTogglePublish,
  publishing
}) {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const published = r.published;
  const hasDetail = r.content || r.performance || r.homework || r.next_plan;
  return <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {r.student_name ?? uiT("未知学员")}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {fmtTime(r.scheduled_at)}
            </span>
            {r.duration_min ? <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {r.duration_min}{" " + uiT("分钟") + " "}</span> : null}
            {r.teacher_name && <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                <GraduationCap className="w-3 h-3" />
                {r.teacher_name}
              </span>}
          </div>
        </div>
        <Badge className={published ? "bg-success-50 text-success-700 border-success-200 dark:bg-success-900/25 dark:text-success-300 dark:border-success-800 " : "bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-900/25 dark:text-warning-300 dark:border-warning-800 "}>
          {published ? <span className="inline-flex items-center gap-1">
              <Eye className="w-3 h-3" />{" " + uiT("家长可见") + " "}</span> : <span className="inline-flex items-center gap-1">
              <EyeOff className="w-3 h-3" />{" " + uiT("仅内部") + " "}</span>}
        </Badge>
      </div>

      {hasDetail ? <div className="mt-3 space-y-1.5">
          <Field label={uiT("学习内容")} value={r.content} />
          <Field label={uiT("课堂表现")} value={r.performance} />
          <Field label={uiT("课后作业")} value={r.homework} />
          {open && <Field label={uiT("下一步")} value={r.next_plan} />}
          {r.next_plan && <button onClick={() => setOpen(v => !v)} className="text-xs text-primary-700 dark:text-primary-400 hover:underline">
              {open ? uiT("收起下一步计划") : uiT("查看下一步计划")}
            </button>}
        </div> : <div className="mt-3 text-sm text-gray-500 dark:text-gray-400 italic">{" " + uiT("老师只点了完成，没有填写任何反馈内容") + " "}</div>}

      <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">{" " + uiT("记录于") + " "}{fmtTime(r.created_at)}
          {r.author_name && r.author_name !== r.teacher_name ? uiT(" · 由 {0} 填写", [r.author_name]) : ""}
        </span>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={publishing} onClick={() => onTogglePublish(r, !published)}>
            {published ? <>
                <EyeOff className="w-3 h-3 mr-1" />{" " + uiT("撤回") + " "}</> : <>
                <Send className="w-3 h-3 mr-1" />{" " + uiT("发布给家长") + " "}</>}
          </Button>
          {r.student_id && <a href={`/students/${r.student_id}`} className="text-xs text-primary-700 dark:text-primary-400 hover:underline">{" " + uiT("学员详情 →") + " "}</a>}
        </div>
      </div>
    </Card>;
}
export default function ReportsPage() {
  useUiLanguage();
  const [preset, setPreset] = useState("30");
  const [published, setPublished] = useState("all");
  const [studentId, setStudentId] = useState("");
  const [teacherId, setTeacherId] = useState("");

  // 学员详情页的「课后反馈 →」带 ?studentId= 跳进来, 直接预选该学员。
  // 不读 URL 的话那个入口点了没反应, 是最容易被漏掉的那种 bug。
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStudentId = searchParams.get("studentId") || "";
  useEffect(() => {
    if (!urlStudentId) return;
    setStudentId(urlStudentId);
    setPreset("all"); // 指定学员时看全部, 别被默认近 30 天砍掉历史反馈
  }, [urlStudentId]);
  const {
    from,
    to
  } = useMemo(() => {
    if (preset === "all") return {
      from: "",
      to: ""
    };
    return {
      from: daysAgo(Number(preset)),
      to: ""
    };
  }, [preset, uiLocale()]);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (published !== "all") p.set("published", published);
    if (studentId) p.set("studentId", studentId);
    if (teacherId) p.set("teacherId", teacherId);
    p.set("pageSize", "50");
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [from, to, published, studentId, teacherId, uiLocale()]);
  const {
    data,
    isLoading,
    error
  } = useQuery({
    queryKey: ["reports", qs],
    queryFn: async () => (await http(`/reports${qs}`)).data
  });
  const {
    data: students = []
  } = useQuery({
    queryKey: ["students", "options"],
    queryFn: async () => (await http("/students?pageSize=200")).data ?? [],
    staleTime: 300000
  });
  const {
    data: teachers = []
  } = useQuery({
    queryKey: ["teachers", "options"],
    queryFn: async () => (await http("/teachers")).data ?? [],
    staleTime: 300000
  });
  const qc = useQueryClient();
  const toast = useToast();
  const rows = data ?? [];
  const draftCount = rows.filter(r => !r.published).length;

  // 事后发布 / 撤回；成功后刷新列表以更新「家长可见 / 仅内部」标记
  const publishMut = useMutation({
    mutationFn: ({
      r,
      publish
    }) => http(`/reports/${r.record_id}/publish`, {
      method: publish ? "POST" : "DELETE"
    }),
    onSuccess: () => qc.invalidateQueries({
      queryKey: ["reports"]
    }),
    onError: e => toast.error(e?.message || uiT("操作失败"))
  });
  function exportExcel() {
    try {
      exportRowsToXlsx(uiT("课后反馈_{0}.xlsx", [new Date().toISOString().slice(0, 10)]), uiT("反馈"), rows, {
        学员: "student_name",
        老师: "teacher_name",
        上课时间: r => fmtTime(r.scheduled_at),
        学习内容: "content",
        课堂表现: "performance",
        课后作业: "homework",
        状态: r => r.published ? uiT("已发布") : uiT("草稿")
      });
      toast.success(uiT("已导出 {0} 条反馈", [rows.length]));
    } catch (e) {
      toast.error(e?.message || uiT("导出失败"));
    }
  }
  return <div className="min-h-full">
      <PageHeader icon={FileText} title={uiT("课后反馈")} subtitle={isLoading ? uiT("加载中…") : uiT("{0} 条{1}", [rows.length, draftCount ? uiT(" · {0} 条未发布", [draftCount]) : ""])} actions={<Button variant="outline" size="sm" onClick={exportExcel} disabled={!rows.length}>
            <FileDown className="w-3.5 h-3.5 mr-1" />{" " + uiT("导出 Excel") + " "}</Button>} />

      <main className="page-body space-y-4">
        {/* 筛选 */}
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={preset} onChange={setPreset} items={RANGES()} />
            <Segmented value={published} onChange={setPublished} items={PUBLISHED_FILTERS()} />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <User className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-500 dark:text-gray-400" />
              <select value={studentId} onChange={e => setStudentId(e.target.value)} className="pl-8 pr-3 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                <option value="">{uiT("全部学员")}</option>
                {students.map(s => <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>)}
              </select>
            </div>
            <div className="relative">
              <GraduationCap className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-500 dark:text-gray-400" />
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)} className="pl-8 pr-3 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                <option value="">{uiT("全部老师")}</option>
                {teachers.map(t => <option key={t.id ?? t.profile_id} value={t.profile_id ?? t.id}>
                    {t.full_name ?? t.name ?? "?"}
                  </option>)}
              </select>
            </div>
            {(studentId || teacherId || published !== "all" || preset !== "30") && <button onClick={() => {
            setStudentId("");
            setTeacherId("");
            setPublished("all");
            setPreset("30");
            // 必须把 URL 上的 studentId 也清掉, 否则上面的 useEffect 会立刻把它设回来,
            // 表现就是「点了重置但学员筛选没变」。
            if (searchParams.has("studentId")) {
              const next = new URLSearchParams(searchParams);
              next.delete("studentId");
              setSearchParams(next, {
                replace: true
              });
            }
          }} className="text-sm px-3 h-9 rounded-md text-gray-500 dark:text-gray-400 hover:text-primary-700 dark:hover:text-primary-300 ">{" " + uiT("重置") + " "}</button>}
          </div>
        </Card>

        {error && <Card className="p-4 bg-danger-50 border-danger-200 text-danger-700 text-sm dark:bg-danger-900/25 dark:border-danger-800 dark:text-danger-300 ">{" " + uiT("加载失败:") + " "}{error.message}
          </Card>}

        {isLoading && <LoadingCard />}

        {!isLoading && rows.length === 0 && !error && <Card className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
              <Search className="w-6 h-6 text-gray-500 dark:text-gray-400 " />
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("这个范围内还没有课后反馈") + " "}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{" " + uiT("老师在「今日课程」里点完成后填写才会出现在这里") + " "}</div>
          </Card>}

        {!isLoading && rows.map(r => <ReportCard key={r.record_id} r={r} onTogglePublish={(rec, publish) => publishMut.mutate({
        r: rec,
        publish
      })} publishing={publishMut.isPending} />)}

        {!isLoading && rows.length === 50 && <div className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2">{" " + uiT("最多显示 50 条，缩小筛选范围可查看更多") + " "}</div>}
      </main>
    </div>;
}
