import { useState } from "react";
import { Link } from "react-router-dom";
import LeadConversionDialog from "./LeadConversionDialog.jsx";
import LeadCreateDialog from "./LeadCreateDialog.jsx";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Sparkles, Phone, User, Calendar, Plus, BookOpen, Clock } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { useToast } from "../../components/ui/toast.jsx";

const STATUS_META = {
  new: { label: "新线索", tone: "default" },
  contacted: { label: "已联系", tone: "warning" },
  trial_scheduled: { label: "已排试听", tone: "default" },
  converted: { label: "已成交", tone: "success" },
  lost: { label: "已流失", tone: "secondary" },
};

const STATUS_FLOW = ["new", "contacted", "trial_scheduled", "converted"];

// 距期望试听日期还有几天。已过期的返回负数, 不会标成「临近」。
function daysUntil(ymd) {
  const target = Date.parse(`${ymd}T00:00:00+08:00`);
  if (Number.isNaN(target)) return Infinity;
  return Math.ceil((target - Date.now()) / 86400000);
}

export default function LeadsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [converting, setConverting] = useState(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const {
    data: allLeads = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["leads", "all"],
    queryFn: async () => {
      return (await http("/leads")).data ?? [];
    },
    refetchInterval: 30000,
  });

  const leads =
    statusFilter === "all" ? allLeads : allLeads.filter((l) => l.status === statusFilter);
  const counts = allLeads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  const toast = useToast();
  const update = useMutation({
    mutationFn: async ({ id, status }) =>
      http(`/leads/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`状态已更新为${STATUS_META[vars.status]?.label || vars.status}`);
    },
    onError: (e) => toast.error(e?.message || "状态更新失败"),
  });

  return (
    <div className="min-h-full">
      <PageHeader
        icon={Sparkles}
        title="招生 / 试听线索"
        subtitle={`共 ${allLeads.length} 条线索 · 跟进与试听安排`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新增线索
          </Button>
        }
      />

      <main className="page-body space-y-4">
        {!isLoading && !error && (
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">线索状态概览</h2>
              <span className="text-sm text-gray-500 dark:text-gray-400 ">
                成交占比{" "}
                {allLeads.length
                  ? (((counts.converted || 0) / allLeads.length) * 100).toFixed(1)
                  : "0.0"}
                %
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[...STATUS_FLOW, "lost"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={`rounded-xl p-3 text-left ring-1 transition ${statusFilter === s ? "bg-primary-50 ring-primary-500 dark:bg-primary-900/30" : "bg-gray-50 ring-gray-100 hover:ring-primary-300 dark:bg-gray-800 dark:ring-gray-700"}`}
                >
                  <span className="block text-2xl font-semibold tabular-nums">
                    {counts[s] || 0}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {STATUS_META[s].label}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 ">
              按已加载线索的当前状态统计；成交占比为已成交 / 全部线索。
            </p>
          </Card>
        )}
        {/* 状态筛选 pills */}
        <Segmented
          value={statusFilter}
          onChange={setStatusFilter}
          items={[
            { key: "all", label: `全部 ${allLeads.length}` },
            ...STATUS_FLOW.map((s) => ({
              key: s,
              label: `${STATUS_META[s].label} ${counts[s] || 0}`,
            })),
            { key: "lost", label: `已流失 ${counts.lost || 0}` },
          ]}
        />

        {/* 线索列表 */}
        {isLoading ? (
          <LoadingCard />
        ) : error ? (
          <Card className="p-5">
            <p role="alert">线索加载失败，请重试。</p>
            <Button variant="outline" className="mt-3" onClick={() => refetch()}>
              重试
            </Button>
          </Card>
        ) : leads.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
              <Sparkles className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {statusFilter === "all" ? "暂无招生线索" : "当前状态暂无招生线索"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1">
              {statusFilter === "all"
                ? "家长提交试听报名后，会显示在这里"
                : "可切换到全部查看其他线索"}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => window.open("/recruit", "_blank")}
            >
              <Plus className="w-3 h-3 mr-1" />
              打开报名页
            </Button>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {leads.map((lead) => {
                const meta = STATUS_META[lead.status] || STATUS_META.new;
                return (
                  <li
                    key={lead.id}
                    className="px-5 py-4 hover:bg-gray-50 dark:bg-gray-950/50 transition dark:hover:bg-gray-800/40 "
                  >
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {lead.parent_name}
                          </span>
                          <a
                            href={`tel:${lead.parent_phone}`}
                            className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300 "
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {lead.parent_phone}
                          </a>
                          <Badge variant={meta.tone}>{meta.label}</Badge>
                        </div>
                        <div className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 dark:text-gray-400 flex items-center gap-3 flex-wrap">
                          {lead.child_name && (
                            <span className="inline-flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                              {lead.child_name}
                              {lead.child_age && (
                                <span className="text-gray-500 dark:text-gray-400">
                                  · {lead.child_age} 岁
                                </span>
                              )}
                            </span>
                          )}
                          {lead.intended_course && (
                            <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300">
                              <BookOpen className="w-3.5 h-3.5 text-primary-500" />
                              {lead.intended_course}
                            </span>
                          )}
                          {lead.trial_date && (
                            <span
                              className={`inline-flex items-center gap-1 ${
                                // 期望日期就在今明两天: 标红提醒教务优先回电
                                daysUntil(lead.trial_date) <= 2
                                  ? "text-danger-600 font-medium dark:text-danger-300 "
                                  : "text-gray-500 dark:text-gray-400 dark:text-gray-400"
                              }`}
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              试听 {lead.trial_date}
                              {daysUntil(lead.trial_date) <= 2 && <span>· 临近</span>}
                            </span>
                          )}
                          {lead.preferred_time && (
                            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 dark:text-gray-400">
                              <Clock className="w-3.5 h-3.5" />
                              {lead.preferred_time}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(lead.created_at).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              hour12: false,
                            })}
                          </span>
                        </div>
                        {lead.notes && (
                          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400 bg-gray-50 dark:bg-gray-950 rounded px-3 py-1.5">
                            {lead.notes}
                          </div>
                        )}
                      </div>
                      {/* 状态流转 */}
                      <div className="flex w-full flex-wrap gap-2 shrink-0 sm:w-auto sm:flex-col sm:gap-1">
                        {STATUS_FLOW.filter((s) => s !== lead.status).map((s) => (
                          <button
                            key={s}
                            onClick={() =>
                              s === "converted"
                                ? setConverting(lead)
                                : update.mutate({ id: lead.id, status: s })
                            }
                            disabled={update.isPending}
                            className="text-xs px-2.5 h-7 rounded border border-gray-300 dark:border-gray-700 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50 transition whitespace-nowrap dark:hover:bg-primary-950/40 dark:hover:border-primary-800 dark:hover:text-primary-300 "
                          >
                            → {STATUS_META[s].label}
                          </button>
                        ))}
                        {lead.status !== "lost" && (
                          <button
                            onClick={() => {
                              if (confirm("确定标记为流失?"))
                                update.mutate({ id: lead.id, status: "lost" });
                            }}
                            className="text-xs px-2.5 h-7 rounded text-gray-500 dark:text-gray-400 dark:text-gray-400 hover:text-danger-600 transition dark:hover:text-danger-300 "
                          >
                            标记流失
                          </button>
                        )}
                        {lead.converted_student_id && (
                          <Link
                            className="text-sm text-primary-700 dark:text-primary-300"
                            to={`/students/${lead.converted_student_id}`}
                          >
                            学员档案 ›
                          </Link>
                        )}
                        {lead.conversion_pending_student_id && (
                          <Link
                            className="text-xs text-warning-700 dark:text-warning-300"
                            to={`/students/${lead.conversion_pending_student_id}`}
                          >
                            建档待完成，查看已建档案 ›
                          </Link>
                        )}
                        {lead.status === "converted" && !lead.converted_student_id && (
                          <Button size="sm" variant="outline" onClick={() => setConverting(lead)}>
                            补建或关联档案
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </main>
      {converting && <LeadConversionDialog lead={converting} onClose={() => setConverting(null)} />}
      {creating && <LeadCreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
