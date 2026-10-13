import { expandWeekly } from "../../lib/weeklySchedule.js";
import TeacherAvailabilityPanel from "./TeacherAvailabilityPanel.jsx";
import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Sparkles,
  CalendarDays,
  Users,
  GraduationCap,
  Download,
  History,
} from "lucide-react";
import { useSchedule } from "./useSchedule.js";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { MoreActions } from "../../components/MoreActions.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import WeekGrid from "./WeekGrid.jsx";
import MonthGrid from "./MonthGrid.jsx";
import TeacherWeekGrid from "./TeacherWeekGrid.jsx";
import StudentWeekGrid from "./StudentWeekGrid.jsx";
import MobileScheduleList from "./MobileScheduleList.jsx";
import AxisFilter from "./AxisFilter.jsx";
import LessonDetailModal from "./LessonDetailModal.jsx";
import { useAuth } from "../auth/useAuth.js";
import ScheduleChecks from "./ScheduleChecks.jsx";
import RescheduleDialog from "./RescheduleDialog.jsx";
import {
  analyzeSchedule,
  DEFAULT_LOAD_LIMITS,
  matchesScheduleFilter,
  schoolInput,
  schoolDay,
} from "./scheduleInsights.js";
import { useInstitution } from "../admin/InstitutionContext.jsx";
function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export default function SchedulePage() {
  useUiLanguage();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [anchor, setAnchor] = useState(startOfWeek());
  const [showNew, setShowNew] = useState(false);
  const [slotPreset, setSlotPreset] = useState(null);
  const [showGen, setShowGen] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [detailLessonId, setDetailLessonId] = useState(null);
  const [moveRequest, setMoveRequest] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const { rules, loading: institutionLoading, error: institutionError } = useInstitution();
  const limits = rules.loadLimits || DEFAULT_LOAD_LIMITS;

  // 视图: week | month | teacher(仅admin) | student(仅admin)
  //
  // ⚠️ viewMode 曾有两个副本（viewMode + viewMode）：渲染用 viewMode、导出用 viewMode
  // → 两套状态易发散。现在只保留 viewMode 一个源，非管理员的收窄放在 setView 里。
  // 视图与锚点都写进 URL（?view=&anchor=）：刷新能恢复，也能把当前视图分享出去。
  const [viewMode, setViewModeRaw] = useState("week");
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [searchParams, setSearchParams] = useSearchParams();

  // 非管理员（老师/家长）只看自己的只读 周/月：锁掉 teacher/student 轴。
  const setView = useCallback(
    (v) => {
      if (!isAdmin && v !== "week" && v !== "month") return;
      setViewModeRaw(v);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", v);
          return next;
        },
        {
          replace: true,
        },
      );
    },
    [isAdmin, setSearchParams, uiLocale()],
  );

  // 进入页面时读一次 URL 恢复视图与锚点；之后由 setView / 翻页维护。
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "week" || v === "month" || (isAdmin && (v === "teacher" || v === "student"))) {
      setViewModeRaw(v);
    }
    const a = searchParams.get("anchor");
    if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) {
      const d = new Date(`${a}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        setAnchor(d);
        setMonthAnchor(d);
      }
    }
    // 只在挂载时读一次 URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 老师视图状态
  const [teacherDay, setTeacherDay] = useState(() => new Date());
  const [selectedTeacherIds, setSelectedTeacherIds] = useState([]); // [] = 全部
  // 学员视图状态 (独立日期 + 学员筛选)
  const [studentDay, setStudentDay] = useState(() => new Date());
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);

  // 老师 + 学员列表 (用于筛选 chips)
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", "list"],
    queryFn: async () => (await http("/teachers")).data ?? [],
    enabled: isAdmin, // 老师/学员轴仅管理员使用
  });
  const allTeachers = useMemo(() => {
    const arr = Array.isArray(teachersData)
      ? teachersData
      : (teachersData?.items ?? teachersData ?? []);
    return arr.map((t) => ({
      id: t.profile_id || t.id,
      name: t.full_name || t.name || "—",
    }));
  }, [teachersData, uiLocale()]);
  const { data: studentsData } = useQuery({
    queryKey: ["students", "all"],
    queryFn: async () => (await http("/students?pageSize=200")).data ?? [],
    enabled: isAdmin,
  });
  const allStudents = useMemo(() => {
    const arr = Array.isArray(studentsData)
      ? studentsData
      : (studentsData?.items ?? studentsData ?? []);
    return arr.map((s) => ({
      id: s.id,
      name: s.full_name || s.name || "—",
    }));
  }, [studentsData, uiLocale()]);
  const { from, to } = useMemo(() => {
    if (viewMode !== "teacher" && viewMode !== "student")
      return {
        from: anchor.toISOString(),
        to: addDays(anchor, 7).toISOString(),
      };
    const day = viewMode === "teacher" ? teacherDay : studentDay;
    const weekly = (viewMode === "teacher" ? selectedTeacherIds : selectedStudentIds).length === 1;
    const start = weekly
      ? startOfWeek(day)
      : new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return {
      from: start.toISOString(),
      to: addDays(start, weekly ? 7 : 1).toISOString(),
    };
  }, [
    anchor,
    viewMode,
    teacherDay,
    studentDay,
    selectedTeacherIds,
    selectedStudentIds,
    uiLocale(),
  ]);
  const {
    data: weekLessons = [],
    isLoading: weekLoading,
    error: weekError,
    refetch: retryWeek,
  } = useSchedule({
    from,
    to,
    includeChanges: true,
    enabled: viewMode !== "month",
    teacherId:
      viewMode === "teacher" && selectedTeacherIds.length === 1 ? selectedTeacherIds[0] : undefined,
    studentId:
      viewMode === "student" && selectedStudentIds.length === 1 ? selectedStudentIds[0] : undefined,
  });

  // 月视图窗口：覆盖整月的网格起止（月初所在周周一 → 月末所在周周日）
  const monthWindow = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
    const start = startOfWeek(first);
    const end = addDays(startOfWeek(last), 7);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }, [monthAnchor, uiLocale()]);
  // 月视图查询：只在切到月视图时才发，否则每次进页面都多打一次全月请求。
  const {
    data: rawMonthLessons = [],
    isLoading: monthLoading,
    error: monthError,
    refetch: retryMonth,
  } = useSchedule({
    from: monthWindow.from,
    to: monthWindow.to,
    enabled: viewMode === "month",
    includeChanges: true,
  });
  const rawLessons = useMemo(
    () =>
      weekLessons.filter(
        (lesson) =>
          Date.parse(lesson.scheduled_at) >= Date.parse(from) &&
          Date.parse(lesson.scheduled_at) < Date.parse(to),
      ),
    [weekLessons, from, to, uiLocale()],
  );
  const rawMonth = useMemo(
    () =>
      rawMonthLessons.filter(
        (lesson) =>
          Date.parse(lesson.scheduled_at) >= Date.parse(monthWindow.from) &&
          Date.parse(lesson.scheduled_at) < Date.parse(monthWindow.to),
      ),
    [rawMonthLessons, monthWindow, uiLocale()],
  );
  const lessons = useMemo(
    () => rawLessons.filter((lesson) => matchesScheduleFilter(lesson, statusFilter)),
    [rawLessons, statusFilter, uiLocale()],
  );
  const monthLessons = useMemo(
    () => rawMonth.filter((lesson) => matchesScheduleFilter(lesson, statusFilter)),
    [rawMonth, statusFilter, uiLocale()],
  );
  const shownRaw = viewMode === "month" ? rawMonth : rawLessons;
  const shown = viewMode === "month" ? monthLessons : lessons;
  const isLoading = viewMode === "month" ? monthLoading : weekLoading;
  const loadError = viewMode === "month" ? monthError : weekError;
  const retrySchedule = viewMode === "month" ? retryMonth : retryWeek;
  const insights = useMemo(() => analyzeSchedule(shownRaw, limits), [shownRaw, limits, uiLocale()]);
  const warningMap = user?.role === "parent" ? new Map() : insights.byLesson;
  const isCurrentMonth = useMemo(
    () =>
      monthAnchor.getFullYear() === new Date().getFullYear() &&
      monthAnchor.getMonth() === new Date().getMonth(),
    [monthAnchor, uiLocale()],
  );

  // 历史课节: 当前 anchor 周之前 4 周 (completed / cancelled / no_show)
  // 用独立 fetch 避免污染主 grid 的 from/to 窗口
  const { from: histFrom, to: histTo } = useMemo(
    () => ({
      from: addDays(anchor, -28).toISOString(),
      // 上周日 23:59:59 (anchor 周一往前 1 秒)
      to: new Date(anchor.getTime() - 1000).toISOString(),
    }),
    [anchor, uiLocale()],
  );
  const { data: historyLessons = [] } = useSchedule({
    from: histFrom,
    to: histTo,
    statuses: ["completed", "cancelled", "no_show"],
    enabled: viewMode === "week",
  });
  // 倒序 (最近的在前)
  const sortedHistory = useMemo(
    () =>
      [...historyLessons].sort(
        (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(),
      ),
    [historyLessons, uiLocale()],
  );
  const histStats = useMemo(
    () => ({
      completed: sortedHistory.filter((l) => l.status === "completed").length,
      cancelled: sortedHistory.filter((l) => l.status === "cancelled").length,
      no_show: sortedHistory.filter((l) => l.status === "no_show").length,
    }),
    [sortedHistory, uiLocale()],
  );

  // 老师视图的 lessons: 按 selectedTeacherIds 过滤 (默认全选)
  const filteredTeachers = useMemo(() => {
    if (selectedTeacherIds.length === 0) return allTeachers;
    const set = new Set(selectedTeacherIds);
    return allTeachers.filter((t) => set.has(t.id));
  }, [allTeachers, selectedTeacherIds, uiLocale()]);

  // 学员视图的 students
  const filteredStudents = useMemo(() => {
    if (selectedStudentIds.length === 0) return allStudents;
    const set = new Set(selectedStudentIds);
    return allStudents.filter((s) => set.has(s.id));
  }, [allStudents, selectedStudentIds, uiLocale()]);
  const range =
    viewMode === "month"
      ? monthAnchor.toLocaleDateString(uiLocale(), {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "long",
        })
      : `${new Date(from).toLocaleDateString(uiLocale(), {
          timeZone: "Asia/Shanghai",
        })} ~ ${new Date(Date.parse(to) - 1).toLocaleDateString(uiLocale(), {
          timeZone: "Asia/Shanghai",
        })}`;
  const completed = shown.filter((l) => l.status === "completed").length;
  // 当前显示的是否就是本周（用于「回到本周」按钮的高亮与禁用）
  const isCurrentWeek = useMemo(
    () => startOfWeek().getTime() === anchor.getTime(),
    [anchor, uiLocale()],
  );

  // 单选 chip 时 = "周模式" (展示该 chip 的本周 7 天所有课节)
  // 多选 / 全部 时 = "日模式" (沿用 AxisFilter 选中的单日)
  const teacherWeekMode = selectedTeacherIds.length === 1;
  const studentWeekMode = selectedStudentIds.length === 1;

  // 导出用 lessons:
  //   - 周视图 = 整周
  //   - 老师/学员视图 + weekMode = 该 chip 的本周所有课节
  //   - 老师/学员视图 + day mode = 选中当天 (过滤后)
  const exportLessons = useMemo(() => {
    if (viewMode === "week") return lessons;
    // ⚠️ 月视图曾漏在这里：落到下面的 studentDay 分支，用「周窗口的 lessons」按单日过滤，
    // 于是导出的是某一天而不是整月。现在显式返回整月的 monthLessons。
    if (viewMode === "month") return monthLessons;
    const target = viewMode === "teacher" ? teacherDay : studentDay;
    const weekModeForView = viewMode === "teacher" ? teacherWeekMode : studentWeekMode;
    if (weekModeForView) {
      const ws = startOfWeek(target);
      const we = addDays(ws, 7);
      const idSet = new Set(viewMode === "teacher" ? selectedTeacherIds : selectedStudentIds);
      return lessons.filter((l) => {
        const d = new Date(l.scheduled_at);
        if (d < ws || d >= we) return false;
        const id = viewMode === "teacher" ? l.teacher_id : l.student_id;
        return idSet.has(id);
      });
    }
    return lessons.filter((l) => {
      const d = new Date(l.scheduled_at);
      return (
        d.getFullYear() === target.getFullYear() &&
        d.getMonth() === target.getMonth() &&
        d.getDate() === target.getDate()
      );
    });
  }, [
    lessons,
    monthLessons,
    viewMode,
    teacherDay,
    studentDay,
    selectedTeacherIds,
    selectedStudentIds,
    teacherWeekMode,
    studentWeekMode,
    uiLocale(),
  ]);
  return (
    <div className="min-h-full">
      <PageHeader
        icon={Calendar}
        title={uiT("课程表")}
        subtitle={uiT("{0} · 显示 {1}/{2} 节 · 已完成 {3}", [
          range,
          shown.length,
          shownRaw.length,
          completed,
        ])}
        actions={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setSlotPreset(null);
                  setShowNew(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                {" " + uiT("新建排课") + " "}
              </Button>
              <MoreActions
                actions={[
                  {
                    label: uiT("按规律课生成"),
                    icon: Sparkles,
                    onSelect: () => setShowGen(true),
                  },
                  {
                    label: uiT("导出 Excel"),
                    icon: Download,
                    disabled: !exportLessons.length,
                    onSelect: async () => {
                      try {
                        const { exportScheduleExcel } = await import("./exportScheduleExcel.js");
                        const result = exportScheduleExcel(
                          exportLessons,
                          viewMode,
                          viewMode === "week"
                            ? anchor
                            : viewMode === "month"
                              ? monthAnchor
                              : viewMode === "teacher"
                                ? teacherDay
                                : studentDay,
                          viewMode === "teacher" ? teacherWeekMode : studentWeekMode,
                        );
                        if (result?.ok) toast.success(uiT("已导出 {0} 条课节", [result.count]));
                        else if (result?.reason) toast.error(result.reason);
                      } catch {
                        toast.error(uiT("导出暂时失败，请重试"));
                      }
                    },
                  },
                ]}
              />
            </div>
          ) : null
        }
      />

      <main className="page-body space-y-3">
        {["admin", "teacher"].includes(user?.role) && (
          <details
            open={showAvailability}
            onToggle={(event) => setShowAvailability(event.currentTarget.open)}
            className="rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
          >
            <summary className="cursor-pointer font-medium">
              {uiT("查看教师空闲与个人占用时间")}
            </summary>
            {showAvailability && (
              <div className="mt-3">
                <TeacherAvailabilityPanel
                  anchor={anchor}
                  onSelect={
                    isAdmin
                      ? (slot) => {
                          setSlotPreset(slot);
                          setShowNew(true);
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </details>
        )}
        {/* 视图切换（老师/学员轴仅管理员；老师与家长固定只读周视图）*/}
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented
            value={viewMode}
            onChange={(m) => {
              if (m === "month")
                setMonthAnchor(
                  viewMode === "teacher"
                    ? teacherDay
                    : viewMode === "student"
                      ? studentDay
                      : anchor,
                );
              setView(m);
            }}
            items={
              isAdmin
                ? [
                    {
                      key: "week",
                      label: uiT("周视图"),
                      icon: CalendarDays,
                    },
                    {
                      key: "month",
                      label: uiT("月视图"),
                      icon: CalendarDays,
                    },
                    {
                      key: "teacher",
                      label: uiT("老师视图"),
                      icon: Users,
                    },
                    {
                      key: "student",
                      label: uiT("学员视图"),
                      icon: GraduationCap,
                    },
                  ]
                : [
                    {
                      key: "week",
                      label: uiT("周视图"),
                      icon: CalendarDays,
                    },
                    {
                      key: "month",
                      label: uiT("月视图"),
                      icon: CalendarDays,
                    },
                  ]
            }
          />

          {viewMode === "week" ? (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAnchor(addDays(anchor, -7))}
                className="shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
                {" " + uiT("上周") + " "}
              </Button>
              <Button
                size="sm"
                onClick={() => setAnchor(startOfWeek())}
                className="shrink-0"
                variant={isCurrentWeek ? "outline" : "default"}
                disabled={isCurrentWeek}
              >
                {isCurrentWeek ? uiT("本周") : uiT("回到本周")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAnchor(addDays(anchor, 7))}
                className="shrink-0"
              >
                {" " + uiT("下周") + " "}
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          ) : viewMode === "month" ? (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))
                }
              >
                <ChevronLeft className="w-4 h-4" />
                {" " + uiT("上月") + " "}
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                variant={isCurrentMonth ? "outline" : "default"}
                disabled={isCurrentMonth}
                onClick={() => setMonthAnchor(new Date())}
              >
                {isCurrentMonth ? uiT("本月") : uiT("回到本月")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))
                }
              >
                {" " + uiT("下月") + " "}
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          ) : viewMode === "teacher" ? (
            <AxisFilter
              day={teacherDay}
              setDay={setTeacherDay}
              items={allTeachers}
              selectedIds={selectedTeacherIds}
              setSelectedIds={setSelectedTeacherIds}
              label={uiT("老师")}
              weekMode={teacherWeekMode}
            />
          ) : (
            <AxisFilter
              day={studentDay}
              setDay={setStudentDay}
              items={allStudents}
              selectedIds={selectedStudentIds}
              setSelectedIds={setSelectedStudentIds}
              label={uiT("学员")}
              weekMode={studentWeekMode}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <Label htmlFor="schedule-state" className="text-xs text-gray-500 dark:text-gray-400 ">
            {" " + uiT("课程状态") + " "}
          </Label>
          <select
            id="schedule-state"
            aria-label={uiT("课程状态")}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            {[
              ["all", uiT("全部")],
              ["scheduled", uiT("待上课")],
              ["completed", uiT("已完成")],
              ["exceptions", uiT("全部异常")],
              ["leave", uiT("请假")],
              ["cancelled", uiT("已取消")],
              ["no_show", uiT("缺席")],
              ["rescheduled", uiT("已调课")],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}（{shownRaw.filter((lesson) => matchesScheduleFilter(lesson, key)).length}）
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500 dark:text-gray-400 ">
            {" " + uiT("灰色：取消 · 红色：缺席/冲突 · 黄色：请假 · 蓝紫：调课") + " "}
          </span>
          {isAdmin &&
            shown.some(
              (lesson) =>
                ["cancelled", "no_show"].includes(lesson.status) ||
                lesson.leave_status === "approved",
            ) && (
              <Link
                to="/leave?tab=makeup"
                className="ml-auto text-sm font-medium text-primary-700 dark:text-primary-300 "
              >
                {" " + uiT("补课跟进 →") + " "}
              </Link>
            )}
        </div>
        {shownRaw.some((lesson) => lesson.change_history_available === false) && (
          <div role="alert" className="text-xs text-warning-700 dark:text-warning-300 ">
            {" " + uiT("部分调课记录暂时无法读取，调课筛选可能不完整。") + " "}
            <button type="button" onClick={() => retrySchedule()} className="ml-2 underline">
              {" " + uiT("重试") + " "}
            </button>
          </div>
        )}
        {user?.role !== "parent" && (
          <ScheduleChecks
            insights={insights}
            limits={limits}
            onLessonClick={(lesson) => setDetailLessonId(lesson.id)}
            loading={isLoading}
            error={loadError}
            onRetry={() => retrySchedule()}
            incomplete={shownRaw.some((lesson) => lesson.schedule_list_truncated)}
          />
        )}

        <Card className="overflow-hidden p-0">
          {viewMode === "month" ? (
            // ⚠️ 月视图原本直接渲染 MonthGrid、不看 loading/error：
            // 数据没回来时先闪一个空网格 → 用户以为「本月没课」；接口失败也不报错。
            // 这里补上加载与错误态（与周视图一致）。
            monthLoading ? (
              <div className="p-6">
                <Loading />
              </div>
            ) : monthError ? (
              <div className="p-6 text-sm text-danger-600 dark:text-danger-400">
                {" " + uiT("加载月视图失败：")}
                {monthError.message}
              </div>
            ) : (
              <div className="p-2 sm:p-3">
                {/* 月视图在手机上同样是 7 列网格，装不下。手机端改列表。 */}
                <div className="md:hidden">
                  <MobileScheduleList
                    lessons={monthLessons}
                    students={filteredStudents}
                    teachers={filteredTeachers}
                    hideStudent={user?.role === "parent"}
                    onLessonClick={(l) => setDetailLessonId(l.id)}
                    warnings={warningMap}
                  />
                </div>
                <div className="hidden md:block">
                  <MonthGrid
                    anchor={monthAnchor}
                    lessons={monthLessons}
                    hideStudent={user?.role === "parent"}
                    onLessonClick={(l) => setDetailLessonId(l.id)}
                    warnings={warningMap}
                    draggable={isAdmin}
                    onReschedule={(lesson, request) =>
                      setMoveRequest({
                        lesson,
                        ...request,
                      })
                    }
                  />
                </div>
              </div>
            )
          ) : loadError ? (
            <div role="alert" className="p-5 text-sm text-danger-700 dark:text-danger-300 ">
              {" " + uiT("课表加载失败。") + " "}
              <Button variant="outline" size="sm" className="ml-2" onClick={() => retrySchedule()}>
                {" " + uiT("重试") + " "}
              </Button>
            </div>
          ) : isLoading ? (
            <Loading />
          ) : viewMode === "week" ? (
            <div className="p-2 sm:p-3">
              <div className="md:hidden">
                <MobileScheduleList
                  lessons={lessons}
                  students={filteredStudents}
                  teachers={filteredTeachers}
                  hideStudent={user?.role === "parent"}
                  weekMode
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                />
              </div>
              <div className="hidden md:block">
                <WeekGrid
                  anchor={anchor}
                  lessons={lessons}
                  draggable={isAdmin}
                  hideStudent={user?.role === "parent"}
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                  onReschedule={(lesson, request) =>
                    setMoveRequest({
                      lesson,
                      ...request,
                    })
                  }
                />
              </div>
            </div>
          ) : viewMode === "teacher" ? (
            <div className="p-2 sm:p-3">
              <div className="md:hidden">
                <MobileScheduleList
                  lessons={lessons}
                  teachers={filteredTeachers}
                  hideStudent
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                />
              </div>
              <div className="hidden md:block">
                <TeacherWeekGrid
                  lessons={lessons}
                  teachers={filteredTeachers}
                  date={teacherDay}
                  weekMode={teacherWeekMode}
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                  onReschedule={(lesson, request) =>
                    setMoveRequest({
                      lesson,
                      ...request,
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="p-2 sm:p-3">
              {/* 手机端换成按天分组的列表：网格是横向比较视图，窄屏下
                  72px 最小列宽会被压到读不出字，而且横向比较在手机上也无意义。
                  md 以下走 MobileScheduleList，以上保持原网格。 */}
              <div className="md:hidden">
                <MobileScheduleList
                  lessons={lessons}
                  students={filteredStudents}
                  teachers={filteredTeachers}
                  hideStudent={user?.role === "parent"}
                  weekMode={studentWeekMode}
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                />
              </div>
              <div className="hidden md:block">
                <StudentWeekGrid
                  lessons={lessons}
                  students={filteredStudents}
                  date={studentDay}
                  weekMode={studentWeekMode}
                  onLessonClick={(l) => setDetailLessonId(l.id)}
                  warnings={warningMap}
                  onReschedule={(lesson, request) =>
                    setMoveRequest({
                      lesson,
                      ...request,
                    })
                  }
                />
              </div>
            </div>
          )}
        </Card>

        {/* 历史课节 (最近 4 周, completed / cancelled / no_show) */}
        {viewMode === "week" && sortedHistory.length > 0 && (
          <Card className="overflow-hidden p-0 mt-3">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-gray-500 dark:text-gray-400 " />
                  {" " + uiT("历史课节 (最近 4 周)") + " "}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {" " + uiT("共") + " "}
                  {sortedHistory.length}
                  {" " + uiT("条")}
                  {" · "}
                  {" " + uiT("已完成") + " "}
                  {histStats.completed}
                  {" · "}
                  {" " + uiT("已取消") + " "}
                  {histStats.cancelled}
                  {" · "}
                  {" " + uiT("缺席") + " "}
                  {histStats.no_show}
                </div>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {" " + uiT("按时间倒序 · 点击行查看详情") + " "}
              </div>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <Table aria-label={uiT("历史课节")} className="sm:min-w-[720px]">
                <TableHeader className="bg-gray-50 dark:bg-gray-800/50 sticky top-0 z-10">
                  <TableRow className="text-gray-500 dark:text-gray-400">
                    <TableHead className="px-3 py-2 text-left font-medium">{uiT("日期")}</TableHead>
                    <TableHead className="px-3 py-2 text-left font-medium">{uiT("时间")}</TableHead>
                    <TableHead className="px-3 py-2 text-right font-medium">
                      {uiT("时长")}
                    </TableHead>
                    <TableHead className="px-3 py-2 text-left font-medium">{uiT("学员")}</TableHead>
                    <TableHead className="px-3 py-2 text-left font-medium">{uiT("老师")}</TableHead>
                    <TableHead className="px-3 py-2 text-left font-medium">{uiT("状态")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedHistory.map((l) => {
                    const start = new Date(l.scheduled_at);
                    const end = new Date(start.getTime() + Number(l.duration_min || 60) * 60_000);
                    const dateLabel = uiT("{0}-{1}-{2} 周{3}", [
                      start.getFullYear(),
                      String(start.getMonth() + 1).padStart(2, "0"),
                      String(start.getDate()).padStart(2, "0"),
                      WEEK_LABEL()[start.getDay()],
                    ]);
                    return (
                      <TableRow
                        key={l.id}
                        onClick={() => setDetailLessonId(l.id)}
                        className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition"
                      >
                        <TableCell className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          <button
                            type="button"
                            onClick={() => setDetailLessonId(l.id)}
                            className="text-left font-medium hover:text-primary-700 dark:hover:text-primary-300 "
                          >
                            {dateLabel}
                          </button>
                        </TableCell>
                        <TableCell className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {fmtTimeShort(start)} - {fmtTimeShort(end)}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {l.duration_min || 60}m
                        </TableCell>
                        <TableCell className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {l.students?.full_name || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                          {l.profiles?.full_name || "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 whitespace-nowrap">
                          <HistoryStatusBadge status={l.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </main>

      {isAdmin && showNew && !institutionLoading && !institutionError && (
        <NewLessonModal
          initial={slotPreset}
          defaultDuration={rules.defaultDurationMin}
          anchor={anchor}
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            qc.invalidateQueries({
              queryKey: ["schedules"],
            });
            setShowNew(false);
          }}
        />
      )}
      {isAdmin && showNew && (institutionLoading || institutionError) && (
        <Dialog open onClose={() => setShowNew(false)} title={uiT("读取排课默认规则")}>
          <p className="text-sm">
            {institutionLoading
              ? uiT("正在读取机构默认规则…")
              : uiT("机构规则暂时无法读取，请刷新后重试。")}
          </p>
        </Dialog>
      )}

      {isAdmin && showGen && (
        <GenerateModal
          anchor={anchor}
          onClose={() => setShowGen(false)}
          onSuccess={() => {
            qc.invalidateQueries({
              queryKey: ["schedules"],
            });
          }}
        />
      )}

      {detailLessonId && (
        <LessonDetailModal lessonId={detailLessonId} onClose={() => setDetailLessonId(null)} />
      )}
      {moveRequest && (
        <RescheduleDialog
          key={`${moveRequest.lesson.id}:${moveRequest.proposedAt}`}
          {...moveRequest}
          limits={limits}
          onClose={() => setMoveRequest(null)}
          onSaved={() => toast.success(uiT("课程安排已更新"))}
        />
      )}
    </div>
  );
}
const WEEK_LABEL = () => [
  uiT("日"),
  uiT("一"),
  uiT("二"),
  uiT("三"),
  uiT("四"),
  uiT("五"),
  uiT("六"),
];
export function GenerateModal({ anchor, onClose, onSuccess }) {
  useUiLanguage();
  const toast = useToast();
  const fromDefault = anchor.toISOString().slice(0, 10);
  const toDefault = addDays(anchor, 13).toISOString().slice(0, 10);
  const [courseId, setCourseId] = useState("");
  const [from, setFrom] = useState(fromDefault);
  const [to, setTo] = useState(toDefault);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { data: coursesData } = useQuery({
    queryKey: ["course-templates"],
    queryFn: async () => (await http("/courses")).data,
  });
  const courses = coursesData?.items ?? [];
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await http("/schedules/generate", {
        method: "POST",
        body: {
          course_id: courseId || null,
          from,
          to,
        },
      });
      setResult(r.data);
      onSuccess?.();
      if (r.data?.created) {
        toast.success(uiT("已生成 {0} 节课", [r.data.created]));
      } else {
        toast.info(uiT("没有需要生成的课节"));
      }
    } catch (e) {
      setErr(e);
      toast.error(e?.message || uiT("生成失败"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={uiT("按规律课生成课节")}
      description={uiT("按课程模板的周几/时间批量生成课节, 已生成的自动跳过, 冲突的会列出来")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {" " + uiT("关闭") + " "}
          </Button>
          <Button type="submit" form="gen-form" disabled={busy}>
            {busy ? uiT("生成中…") : uiT("生成")}
          </Button>
        </>
      }
    >
      <form id="gen-form" onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="gen-course">{uiT("课程模板")}</Label>
          <select
            id="gen-course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{uiT("全部启用的模板")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {" " + uiT("· 周")}
                {WEEK_LABEL()[c.weekday]} {String(c.start_time).slice(0, 5)} ·{" "}
                {c.recurrence === "weekly"
                  ? uiT("每周")
                  : c.recurrence === "biweekly"
                    ? uiT("隔周")
                    : c.recurrence}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="gen-from">{uiT("开始日期 *")}</Label>
            <Input
              id="gen-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-to">{uiT("结束日期 *")}</Label>
            <Input
              id="gen-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {" " + uiT("一次最多生成 62 天, 建议每次生成 2~4 周。") + " "}
        </div>
        {err && (
          <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
            {err.message}
          </div>
        )}
        {result && (
          <div className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 space-y-1">
            <div>
              {" " + uiT("新建") + " "}
              <b>{result.created}</b>
              {" " + uiT("节 · 已存在跳过") + " "}
              {result.skipped_existing}
              {" " + uiT("· 冲突跳过")} {result.skipped_conflict}
            </div>
            {result.conflicts?.length > 0 && (
              <ul className="list-disc pl-5 text-warning-700 dark:text-warning-300 space-y-0.5">
                {result.conflicts.map((c, i) => (
                  <li key={i}>
                    {new Date(c.scheduled_at).toLocaleString(uiLocale(), {
                      timeZone: "Asia/Shanghai",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}{" "}
                    {c.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
function NewLessonModal({ anchor, onClose, onSuccess, initial = null, defaultDuration = 60 }) {
  useUiLanguage();
  const toast = useToast();
  // 默认时间 = 本周某天 (anchor 周内, 不会超出 useSchedule 的 from/to 窗口)
  // 选 anchor + 6 天 (周日) 16:00 —— 一定落在本周内
  const [year, month, day] = schoolDay(anchor.toISOString()).split("-").map(Number);
  const defaultDate = new Date(Date.UTC(year, month - 1, day + 6, 8, 0, 0));
  const [form, setForm] = useState({
    student_id: "",
    teacher_id: "",
    scheduled_at: schoolInput(defaultDate.toISOString()),
    duration_min: defaultDuration,
    ...(initial || {}),
  });
  // 重复: none (单次) | weekly (每周) | biweekly (隔周)
  const [recurrence, setRecurrence] = useState("none");
  const [weeklySlots, setWeeklySlots] = useState([{ weekday: 1, time: "16:00" }]);
  const [repeatCount, setRepeatCount] = useState(8); // 默认 8 周
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [progress, setProgress] = useState(null); // { done, total, conflicts }
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([http("/students?pageSize=100"), http("/teachers")]);
        setStudents(s.data || []);
        setTeachers(t.data || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setProgress(null);
    const baseIso = new Date(form.scheduled_at + ":00+08:00").toISOString();
    const baseDate = new Date(baseIso);
    const weeks = recurrence === "none" ? 1 : Math.max(1, Math.min(52, Number(repeatCount) || 1));
    let candidates;
    try {
      candidates =
        recurrence === "none"
          ? [baseIso]
          : expandWeekly({
              startInput: form.scheduled_at,
              weeks,
              intervalWeeks: recurrence === "biweekly" ? 2 : 1,
              slots: weeklySlots,
            });
    } catch (e) {
      setErr(e);
      setBusy(false);
      return;
    }
    const total = candidates.length;
    const stepDays = recurrence === "biweekly" ? 14 : recurrence === "weekly" ? 7 : 0;
    try {
      const created = [];
      const conflicts = [];
      for (let i = 0; i < total; i++) {
        const at = candidates[i];
        try {
          const r = await http("/schedules", {
            method: "POST",
            body: {
              ...form,
              scheduled_at: at,
            },
          });
          created.push(r.data);
        } catch (e2) {
          conflicts.push({
            scheduled_at: at,
            reason: e2?.message || uiT("失败"),
          });
        }
        setProgress({
          done: i + 1,
          total,
          conflicts: conflicts.length,
        });
      }
      if (created.length === total) {
        toast.success(
          total === 1 ? uiT("排课已创建") : uiT("已创建 {0} 节循环课节", [created.length]),
        );
        onSuccess();
      } else if (created.length > 0) {
        toast.warning(uiT("已创建 {0} 节, {1} 节冲突", [created.length, conflicts.length]));
        onSuccess();
      } else {
        // 全部失败
        setErr(new Error(conflicts[0]?.reason || uiT("全部冲突, 未创建")));
        toast.error(uiT("排课失败, 请检查时间冲突"));
      }
    } catch (e) {
      setErr(e);
      toast.error(e?.message || uiT("排课失败"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={uiT("新建排课")}
      description={uiT("选择学员和老师, 排课会自动检测时间冲突")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {" " + uiT("取消") + " "}
          </Button>
          <Button
            type="submit"
            form="new-lesson-form"
            disabled={busy || (recurrence !== "none" && !weeklySlots.length)}
          >
            {busy ? uiT("保存中...") : uiT("保存")}
          </Button>
        </>
      }
    >
      <form id="new-lesson-form" onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="schedule-student">{uiT("学员 *")}</Label>
          <select
            id="schedule-student"
            required
            value={form.student_id}
            onChange={(e) =>
              setForm({
                ...form,
                student_id: e.target.value,
              })
            }
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{uiT("-- 选择学员 --")}</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="schedule-teacher">{uiT("老师 *")}</Label>
          <select
            id="schedule-teacher"
            required
            value={form.teacher_id}
            onChange={(e) =>
              setForm({
                ...form,
                teacher_id: e.target.value,
              })
            }
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{uiT("-- 选择老师 --")}</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.profile_id || t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-time">{uiT("时间 *")}</Label>
            <Input
              id="schedule-time"
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) =>
                setForm({
                  ...form,
                  scheduled_at: e.target.value,
                })
              }
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-dur">{uiT("时长 (分钟) *")}</Label>
            <Input
              id="schedule-dur"
              type="number"
              value={form.duration_min}
              onChange={(e) =>
                setForm({
                  ...form,
                  duration_min: Number(e.target.value),
                })
              }
              min={15}
              max={240}
              required
            />
          </div>
        </div>

        {/* 周期 / 重复 */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Label className="text-xs">{uiT("重复:")}</Label>
            <Segmented
              size="sm"
              value={recurrence}
              onChange={setRecurrence}
              items={[
                {
                  key: "none",
                  label: uiT("单次"),
                },
                {
                  key: "weekly",
                  label: uiT("每周"),
                },
                {
                  key: "biweekly",
                  label: uiT("隔周"),
                },
              ]}
            />
            {recurrence !== "none" && (
              <div className="flex items-center gap-1.5 ml-2">
                <Label htmlFor="repeat-count" className="text-xs text-gray-500 dark:text-gray-400">
                  {" " + uiT("周数:") + " "}
                </Label>
                <Input
                  id="repeat-count"
                  type="number"
                  min={1}
                  max={52}
                  value={repeatCount}
                  onChange={(e) =>
                    setRepeatCount(Math.max(1, Math.min(52, Number(e.target.value) || 1)))
                  }
                  className="w-16 h-7 text-xs"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  (
                  {recurrence === "weekly"
                    ? uiT("至 {0}", [
                        addDays(
                          new Date(form.scheduled_at),
                          7 * repeatCount - 1,
                        ).toLocaleDateString(uiLocale(), {
                          timeZone: "Asia/Shanghai",
                        }),
                      ])
                    : uiT("至 {0}", [
                        addDays(
                          new Date(form.scheduled_at),
                          14 * repeatCount - 1,
                        ).toLocaleDateString(uiLocale(), {
                          timeZone: "Asia/Shanghai",
                        }),
                      ])}
                  )
                </span>
              </div>
            )}
          </div>
          {recurrence !== "none" && (
            <div className="space-y-2">
              <p className="text-sm">{uiT("选择每周上课日，分别设置时间（北京时间）")}</p>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <div key={d} className="flex items-center justify-between gap-3">
                  <label className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={weeklySlots.some((x) => x.weekday === d)}
                      onChange={(e) =>
                        setWeeklySlots(
                          e.target.checked
                            ? [
                                ...weeklySlots,
                                { weekday: d, time: form.scheduled_at.slice(11, 16) || "16:00" },
                              ]
                            : weeklySlots.filter((x) => x.weekday !== d),
                        )
                      }
                    />
                    {uiT(["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d])}
                  </label>
                  {weeklySlots.some((x) => x.weekday === d) && (
                    <Input
                      aria-label={
                        uiT(["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d]) +
                        uiT("上课时间")
                      }
                      type="time"
                      className="w-36"
                      value={weeklySlots.find((x) => x.weekday === d).time}
                      onChange={(e) =>
                        setWeeklySlots(
                          weeklySlots.map((x) =>
                            x.weekday === d ? { ...x, time: e.target.value } : x,
                          ),
                        )
                      }
                      required
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {recurrence !== "none" && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {uiT(
                "每个选中的星期按各自时间重复；提交时检查已排课程、教师可用时间及个人占用。冲突课次会明确列出。",
              )}
            </div>
          )}
        </div>

        {err && (
          <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 px-3 py-2 rounded dark:bg-danger-900/30 dark:border-danger-800 dark:text-danger-300">
            {err.message}
          </div>
        )}
        {progress && busy && (
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2">
            {" " + uiT("正在创建第") + " "}
            {progress.done}/{progress.total}
            {" " + uiT("节") + " "}
            {progress.conflicts > 0 && uiT(" (已跳过 {0} 个冲突)", [progress.conflicts])}
            ...
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ====== 历史课节辅助 ======

function fmtTimeShort(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function HistoryStatusBadge({ status }) {
  useUiLanguage();
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300">
        {" " + uiT("已完成") + " "}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 line-through">
        {" " + uiT("已取消") + " "}
      </span>
    );
  }
  if (status === "no_show") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
        {" " + uiT("缺席") + " "}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
      {status}
    </span>
  );
}
