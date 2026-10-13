import ParentLessonCard from "./ParentLessonCard.jsx";
import { useInstitution } from "../admin/InstitutionContext.jsx";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Home,
  Clock,
  AlertCircle,
  Users,
  GraduationCap,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { http } from "../../lib/http.js";
import { useRealtime } from "./useRealtime.js";
import FeedList from "./FeedList.jsx";
import LeaveRequestModal from "./LeaveRequestModal.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { Loading } from "../../components/ui/loading.jsx";

function avatarColor(name) {
  const tones = [
    "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ",
    "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ",
    "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ",
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ",
  ];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return tones[hash % tones.length];
}

export default function ParentHomePage() {
  const { rules } = useInstitution();
  const qc = useQueryClient();
  const {
    data: students = [],
    isPending: studentsLoading,
    isError: studentsError,
    refetch: retryStudents,
  } = useQuery({
    queryKey: ["my-students"],
    queryFn: async () => (await http("/students?pageSize=100")).data,
  });
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (!activeId && students.length) setActiveId(students[0].id);
  }, [students, activeId]);

  // 实时订阅成功就用它，否则按 useRealtime 给的间隔轮询 —— 否则家长端会一直显示旧数据
  const live = useRealtime(activeId);

  const {
    data: upcoming = [],
    isPending: upcomingLoading,
    isError: upcomingError,
    refetch: retryUpcoming,
  } = useQuery({
    queryKey: ["parent-upcoming", activeId],
    queryFn: async () => (await http("/parent/lessons/upcoming")).data,
    enabled: !!activeId,
    refetchInterval: live.refetchInterval,
  });

  // 课时预警: 与每日续费提醒推送同一口径
  const { data: renewal } = useQuery({
    queryKey: ["my-renewal"],
    queryFn: async () => (await http("/me/renewal")).data,
    refetchInterval: live.refetchInterval,
  });
  const alerts = renewal?.items ?? [];

  const [leaveTarget, setLeaveTarget] = useState(null);
  const active = students.find((s) => s.id === activeId);
  const activeUpcoming = upcoming.filter((lesson) => lesson.student_id === activeId);

  return (
    <div className="min-h-full">
      <PageHeader
        back={false}
        icon={Home}
        title="孩子的学习"
        subtitle="查看孩子的课程反馈和即将到来的课程"
      />

      <main className="page-body space-y-5">
        {/* 快捷入口: 留言给学校 */}
        <Link
          to="/parent/messages"
          className="flex items-center gap-3 rounded-xl px-1 py-2 text-sm"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">留言给学校</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-400" />
        </Link>

        {/* Kids switcher */}
        {students.length > 1 && (
          <Segmented
            value={activeId}
            onChange={setActiveId}
            items={students.map((s) => ({
              key: s.id,
              label: `${s.full_name} ${s.remaining_hours ?? 0}h`,
              icon: Users,
            }))}
          />
        )}

        {/* Active kid summary */}
        {active && (
          <section className="home-intro">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-full font-semibold text-lg flex items-center justify-center ${avatarColor(active.full_name)}`}
              >
                {active.full_name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-gray-900 dark:text-gray-100">{active.full_name}</h2>
                <p className="mt-1 text-xs">课程、课时和学习进展</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-primary-200 pt-4 dark:border-primary-800">
              <div>
                <p className="text-xs">剩余课时</p>
                <strong
                  className={`mt-1 block text-4xl tabular-nums ${Number(active.remaining_hours ?? 0) < rules.lowBalanceHours ? "text-warning-700 dark:text-warning-300" : "text-primary-800 dark:text-primary-200"}`}
                >
                  {active.remaining_hours ?? 0}
                  <span className="ml-2 text-sm font-normal">小时</span>
                </strong>
              </div>
              <Link
                className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-100"
                to={`/students/${active.id}`}
              >
                查看孩子课时与学习记录
                <ChevronRight className="ml-1 inline h-4 w-4" />
              </Link>
            </div>
          </section>
        )}

        {active && (
          <div className="grid grid-cols-3 gap-3">
            <Link
              to="/schedule"
              className="rounded-xl border border-gray-200 bg-white p-3 text-center text-sm font-medium dark:border-gray-700 dark:bg-gray-900"
            >
              查看课表
            </Link>
            <Link
              to="/leave"
              className="rounded-xl border border-gray-200 bg-white p-3 text-center text-sm font-medium dark:border-gray-700 dark:bg-gray-900"
            >
              请假／补课
            </Link>
            <Link
              to={`/students/${active.id}#hour-ledger`}
              className="rounded-xl border border-gray-200 bg-white p-3 text-center text-sm font-medium dark:border-gray-700 dark:bg-gray-900"
            >
              课时账单
            </Link>
          </div>
        )}
        {active && Number(active.remaining_hours ?? 0) < rules.lowBalanceHours && (
          <Link
            className="mobile-shortcut border-warning-200 text-warning-800 dark:border-warning-800 dark:text-warning-300 "
            to="/parent/messages"
          >
            课时不足，联系教务续费
            <ChevronRight className="ml-auto h-4 w-4" />
          </Link>
        )}
        {/* 课时预警: 低余额 / 即将到期 */}
        {alerts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 px-1">
              课时提醒
            </h2>
            <div className="space-y-2">
              {alerts.map((a) => (
                <Card
                  key={`${a.package_id}-${a.stage}`}
                  className={`p-4 border ${
                    a.stage === "low"
                      ? "border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20"
                      : "border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        a.stage === "low"
                          ? "bg-warning-100 text-warning-600 dark:bg-warning-900/40 dark:text-warning-300"
                          : "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                      }`}
                    >
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {a.stage === "low" ? "课时即将用完" : "课时包即将到期"}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                        {a.student_name} · {a.package_name} · 剩余 {a.remaining_hours}h
                        {a.stage === "expiring" && a.expires_at
                          ? ` · ${new Date(a.expires_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 到期`
                          : ` / 共 ${a.total_hours}h`}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        建议尽快联系老师续费，避免影响上课。
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* 即将到来的课 */}
        {activeId && (
          <div className="role-home-columns">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">即将到来的课</h2>
                <Link
                  className="text-xs font-medium text-primary-700 dark:text-primary-300"
                  to="/schedule"
                >
                  全部课表 ›
                </Link>
              </div>
              {upcomingLoading ? (
                <Loading />
              ) : upcomingError ? (
                <Card className="p-6 text-sm" role="alert">
                  课程加载失败，暂时无法确认上课安排。
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-2"
                    onClick={() => retryUpcoming()}
                  >
                    重试
                  </Button>
                </Card>
              ) : activeUpcoming.length === 0 ? (
                <Card className="p-6 text-center">
                  <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400">
                    暂无安排
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    老师排课后会自动显示在这里
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  {activeUpcoming.slice(0, 3).map((lesson) => (
                    <ParentLessonCard key={lesson.id} lesson={lesson} onLeave={setLeaveTarget} />
                  ))}
                </div>
              )}
            </section>

            {/* 近期反馈 */}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">近期反馈</h2>
                <Link
                  className="text-xs font-medium text-primary-700 dark:text-primary-300"
                  to={`/parent/feeds?studentId=${activeId}`}
                >
                  全部反馈 ›
                </Link>
              </div>
              <FeedList
                studentId={activeId}
                refetchInterval={live.refetchInterval}
                previewLimit={3}
              />
            </section>
          </div>
        )}

        {studentsLoading ? (
          <Loading />
        ) : studentsError ? (
          <Card className="p-6 text-sm" role="alert">
            孩子资料加载失败，请重试或联系教务老师。
            <Button variant="outline" size="sm" className="ml-2" onClick={() => retryStudents()}>
              重试
            </Button>
          </Card>
        ) : (
          students.length === 0 && (
            <Card className="p-8 text-center">
              <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400">
                还没绑定孩子
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                请联系教务老师添加孩子到您的账号
              </div>
            </Card>
          )
        )}
      </main>

      {leaveTarget && (
        <LeaveRequestModal
          lesson={leaveTarget}
          onClose={() => setLeaveTarget(null)}
          onDone={() => {
            setLeaveTarget(null);
            // 原地刷新即将到来的课，显示「请假待确认」，不再整页 reload。
            qc.invalidateQueries({ queryKey: ["parent-upcoming"] });
          }}
        />
      )}
    </div>
  );
}
