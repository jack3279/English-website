import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import StudentPreview from "./StudentPreview.jsx";
import DeleteStudentDialog from "./DeleteStudentDialog.jsx";
import { StudentStatusBadge, studentStatusLabel, STUDENT_STATUSES, STUDENT_STATUS_META } from "./studentStatus.jsx";
import { useState, useMemo, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Search, Users, Cake, ArrowUpRight, FileDown, Trash2 } from "lucide-react";
import { useStudents, useStudentStatusCounts } from "./useStudent.js";
import { useAuth } from "../auth/useAuth.js";
import { useInstitution } from "../admin/InstitutionContext.jsx";
import { http } from "../../lib/http.js";
import { exportRowsToXlsx } from "../../lib/xlsx.js";
import { Button } from "../../components/ui/button.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { MoreActions } from "../../components/MoreActions.jsx";
function avatarColor(name) {
  const tones = ["bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ", "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ", "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ", "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ", "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 ", "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 "];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = hash * 31 + name.charCodeAt(i) & 0xffff;
  return tones[hash % tones.length];
}
export default function StudentsPage() {
  useUiLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const {
    user
  } = useAuth();
  const isAdmin = user?.role === "admin";
  const {
    rules
  } = useInstitution();
  const [previewId, setPreviewId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // 搜索走后端（覆盖全表，不再只在已加载的一页里过滤），300ms 防抖。
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const {
    data: students = [],
    isLoading,
    error
  } = useStudents({
    pageSize: 100,
    search: term
  });
  const { data: counts } = useStudentStatusCounts(term);

  // 关键字已由后端按 姓名/备注 过滤，这里只保留状态筛选。
  const filtered = useMemo(() => {
    return statusFilter === "all" ? students : students.filter(s => s.status === statusFilter);
  }, [students, statusFilter, uiLocale()]);
  useEffect(() => setPage(1), [term, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleStudents = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const createMut = useMutation({
    mutationFn: body => http("/students", {
      method: "POST",
      body
    }),
    onSuccess: response => {
      qc.invalidateQueries({
        queryKey: ["students"]
      });
      qc.invalidateQueries({ queryKey: ["student-status-counts"] });
      setEditTarget(null);
      toast.success(uiT("学员已创建，请完善家长账号关联"));
      if (response.data?.id) navigate(`/students/${response.data.id}`);
    },
    onError: e => toast.error(e?.message || uiT("创建失败"))
  });
  const updateMut = useMutation({
    mutationFn: ({
      id,
      body
    }) => http(`/students/${id}`, {
      method: "PATCH",
      body
    }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["students"]
      });
      qc.invalidateQueries({ queryKey: ["student-status-counts"] });
      setEditTarget(null);
      toast.success(uiT("学员已更新"));
    },
    onError: e => toast.error(e?.message || uiT("更新失败"))
  });
  const statusCount = status => counts?.[status] ?? students.filter(s => s.status === status).length;
  const allCount = counts?.all ?? students.length;
  async function exportStudents() {
    try {
      await exportRowsToXlsx(uiT("学员列表_{0}.xlsx", [new Date().toISOString().slice(0, 10)]), uiT("学员"), filtered, {
        姓名: "full_name",
        生日: "birth_date",
        状态: s => studentStatusLabel(s.status),
        剩余课时: "remaining_hours",
        备注: "notes"
      });
      toast.success(uiT("已导出 {0} 名学员", [filtered.length]));
    } catch (e) {
      toast.error(e?.message || uiT("导出失败"));
    }
  }
  return <div className="min-h-full">
      <PageHeader icon={Users} title={uiT("学员管理")} actions={<Button onClick={() => setEditTarget("new")}>
            <Plus className="w-4 h-4 mr-1" />{" " + uiT("新建学员") + " "}</Button>} />

      <main className="page-body space-y-5">
        <div className="student-master-detail">
          <Card className="overflow-hidden p-0">
            {/* Filters bar */}
            <div className="list-toolbar">
              <div className="relative w-full sm:max-w-xs">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={uiT("按姓名/备注搜索")} aria-label={uiT("搜索学员")} className="pl-9 h-9" />
              </div>
              <Segmented value={statusFilter} onChange={setStatusFilter} items={[{
                key: "all",
                label: uiT("全部 {0}", [allCount])
              }, ...STUDENT_STATUSES.map(st => ({
                key: st,
                label: `${uiT(STUDENT_STATUS_META[st].label)} ${statusCount(st)}`
              }))]} />
              <MoreActions actions={[{
              label: uiT("导出 Excel"),
              icon: FileDown,
              disabled: !filtered.length,
              onSelect: exportStudents
            }]} />
            </div>

            {error && <div role="alert" className="p-4 bg-danger-50 text-danger-700 text-sm dark:bg-danger-900/25 dark:text-danger-300 ">{" " + uiT("加载失败:") + " "}{error.message}
              </div>}

            {/* List */}
            {error ? null : isLoading ? <Loading /> : filtered.length === 0 ? <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <Users className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="text-base font-medium text-gray-700 dark:text-gray-300">
                  {search || statusFilter !== "all" ? uiT("没有匹配的学员") : uiT("还没有学员")}
                </div>
                {!search && statusFilter === "all" && <Button className="mt-4" onClick={() => setEditTarget("new")}>
                    <Plus className="w-4 h-4 mr-1" />{" " + uiT("添加第一位学员") + " "}</Button>}
              </div> : <Table aria-label={uiT("学员档案")} mobileColumns={3} className="sm:min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[210px]">{uiT("学员")}</TableHead>
                    <TableHead>{uiT("生日")}</TableHead>
                    <TableHead>{uiT("状态")}</TableHead>
                    <TableHead className="text-right">{uiT("剩余课时")}</TableHead>
                    <TableHead className="w-[170px] text-right">{uiT("操作")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.map(s => {
                const low = s.status === "active" && (s.remaining_hours ?? 0) < rules.lowBalanceHours;
                const empty = s.status === "active" && (s.remaining_hours ?? 0) <= 0;
                return <TableRow key={s.id} className={`group ${previewId === s.id ? "selected-student-row" : ""}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Link to={`/students/${s.id}`} className={`w-10 h-10 rounded-full font-semibold flex items-center justify-center flex-shrink-0 transition hover:scale-105 ${avatarColor(s.full_name)}`}>
                              {(s.full_name || "?").charAt(0)}
                            </Link>
                            <div className="min-w-0">
                              <Link to={`/students/${s.id}`} className="font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-700 transition flex items-center gap-1 break-all dark:hover:text-primary-300 ">
                                {s.full_name}
                                <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                              </Link>
                              {s.notes && <div title={s.notes} className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                  {s.notes}
                                </div>}
                              {s.course_names?.length > 0 && <p className="mt-1 break-words text-xs text-primary-700 dark:text-primary-300">
                                  {s.course_names.join(" · ")}
                                </p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-gray-500 dark:text-gray-400 text-sm">
                          {s.birth_date ? <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Cake className="hidden w-3.5 h-3.5 shrink-0 text-gray-500 sm:block dark:text-gray-400" />
                              {s.birth_date}
                            </span> : <span className="text-gray-500 dark:text-gray-400">—</span>}
                        </TableCell>
                        <TableCell>
                          <StudentStatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className={`text-base font-semibold tabular-nums ${empty ? "text-danger-600 dark:text-danger-300 " : low ? "text-warning-600 dark:text-warning-300 " : "text-gray-900 dark:text-gray-100"}`}>
                            {s.remaining_hours ?? 0}
                            <span className="text-xs font-normal text-gray-500 dark:text-gray-400 dark:text-gray-400 ml-1">
                              h
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="hidden xl:inline-flex" aria-label={uiT("预览{0}", [s.full_name])} onClick={() => setPreviewId(s.id)}>{" " + uiT("预览") + " "}</Button>
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/students/${s.id}`}>{uiT("查看")}</Link>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditTarget(s)} aria-label={uiT("编辑{0}", [s.full_name])}>
                              <Edit2 className="w-3.5 h-3.5" />{" " + uiT("编辑") + " "}</Button>
                          </div>
                        </TableCell>
                      </TableRow>;
              })}
                </TableBody>
              </Table>}
            {!error && !isLoading && <div className="list-footer">
                <span>
                  {filtered.length ? uiT("显示 {0}–{1} / {2} 位", [(currentPage - 1) * pageSize + 1, Math.min(currentPage * pageSize, filtered.length), filtered.length]) : uiT("没有匹配记录")}
                  {students.length >= 100 && uiT(" · 搜索可查找更多学员")}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{" " + uiT("上一页") + " "}</Button>
                  <span className="px-1 tabular-nums">
                    {currentPage} / {pageCount}
                  </span>
                  <Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{" " + uiT("下一页") + " "}</Button>
                </div>
              </div>}
          </Card>
          <StudentPreview id={previewId} />
        </div>
      </main>

      {editTarget && <StudentFormModal initial={editTarget === "new" ? null : editTarget} onClose={() => setEditTarget(null)} onSubmit={body => {
      if (editTarget === "new") createMut.mutate(body);else updateMut.mutate({
        id: editTarget.id,
        body
      });
    }} onPurge={editTarget !== "new" && isAdmin ? () => setPurgeTarget(editTarget) : null} submitting={createMut.isPending || updateMut.isPending} err={createMut.error || updateMut.error} />}

      {purgeTarget && <DeleteStudentDialog student={purgeTarget} onClose={() => setPurgeTarget(null)} onDeleted={() => {
        setPurgeTarget(null);
        setEditTarget(null);
        qc.invalidateQueries({ queryKey: ["students"] });
        qc.invalidateQueries({ queryKey: ["student-status-counts"] });
      }} />}
    </div>;
}
function StudentFormModal({
  initial,
  onClose,
  onSubmit,
  onPurge,
  submitting,
  err
}) {
  useUiLanguage();
  const [form, setForm] = useState({
    full_name: initial?.full_name || "",
    birth_date: initial?.birth_date || "",
    notes: initial?.notes || "",
    status: initial?.status || "active",
    wecom_external_user_id: initial?.wecom_external_user_id || ""
  });
  return <Dialog open onClose={onClose} title={initial ? uiT("编辑学员") : uiT("新建学员")} description={initial ? initial.full_name : undefined} footer={<>
          <div className="mr-auto flex items-center gap-2">
            {onPurge && <Button variant="destructive" size="sm" onClick={() => {
        onPurge();
        onClose();
      }}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />{" " + uiT("永久删除") + " "}</Button>}
          </div>
          <Button variant="outline" onClick={onClose}>{" " + uiT("取消") + " "}</Button>
          <Button onClick={() => onSubmit(form)} disabled={submitting}>
            {submitting ? uiT("保存中...") : uiT("保存")}
          </Button>
        </>}>
      <form onSubmit={e => {
      e.preventDefault();
      onSubmit(form);
    }} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="student-name" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("姓名 *") + " "}</label>
          <Input id="student-name" value={form.full_name} onChange={e => setForm({
          ...form,
          full_name: e.target.value
        })} required placeholder={uiT("例: 张小明")} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="student-bday" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("生日") + " "}</label>
          <Input id="student-bday" type="date" value={form.birth_date || ""} onChange={e => setForm({
          ...form,
          birth_date: e.target.value
        })} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="student-notes" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("备注") + " "}</label>
          <Input id="student-notes" value={form.notes || ""} onChange={e => setForm({
          ...form,
          notes: e.target.value
        })} placeholder={uiT("特殊需求 / 家长姓名 等")} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="student-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">{" " + uiT("状态") + " "}</label>
          <select id="student-status" value={form.status} onChange={e => setForm({
          ...form,
          status: e.target.value
        })} className="flex h-10 w-full rounded-md border border-gray-300 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 ">
            {STUDENT_STATUSES.map(st => <option key={st} value={st}>{uiT(STUDENT_STATUS_META[st].label)}</option>)}
          </select>
        </div>
        {err && <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded-md dark:text-danger-300 dark:bg-danger-900/25 dark:border-danger-800 ">
            {err.message}
          </div>}
      </form>
    </Dialog>;
}
