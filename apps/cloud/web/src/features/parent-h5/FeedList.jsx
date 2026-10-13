import { BASIC_RECEIPT } from "../../lib/quickFeedback.js";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Calendar, Clock, GraduationCap, Sparkles } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { LoadingCard } from "../../components/ui/loading.jsx";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Section({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {value}
      </div>
    </div>
  );
}

export default function FeedList({ studentId, refetchInterval, previewLimit }) {
  const [detail, setDetail] = useState(null);
  const {
    data: feeds = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["parent-feeds", studentId],
    queryFn: async () => (await http(`/parent/feeds?studentId=${studentId}`)).data,
    enabled: !!studentId,
    // 父组件按「实时订阅是否真的连上」传进来；连不上就靠轮询，
    // 免得家长永远停在上次打开的旧反馈上。
    refetchInterval: refetchInterval ?? false,
  });

  if (isLoading) {
    return <LoadingCard />;
  }

  if (error)
    return (
      <Card className="p-5">
        <p role="alert">上课记录加载失败，请重试。</p>
        <Button variant="outline" className="mt-3" onClick={() => refetch()}>
          重试
        </Button>
      </Card>
    );
  if (feeds.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
          <MessageSquare className="w-6 h-6 text-gray-500 dark:text-gray-400 " />
        </div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">还没有上课记录</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          已上课程可在课表和上课记录中查询；老师确认完课并发送后，会在这里看到。
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {(previewLimit ? feeds.slice(0, previewLimit) : feeds).map((f) => {
        // 分栏内容由 /parent/feeds 按 record_id 关联 records 带出。
        // 老数据(关联缺失时)退回到 summary 那行扁平文本, 不至于显示空白。
        return (
          <Card key={f.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400 mb-2">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {fmtTime(f.scheduled_at || f.published_at)}
                  </span>
                  {f.duration_min ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {f.duration_min} 分钟
                    </span>
                  ) : null}
                  {f.teacher_name && (
                    <span className="inline-flex items-center gap-1">
                      <GraduationCap className="w-3 h-3" />
                      {f.teacher_name}
                    </span>
                  )}
                </div>

                {f.attendance_status && <span className="mb-2 inline-block rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">{{completed:"上课",leave:"请假",no_show:"缺勤",cancelled:"已取消"}[f.attendance_status]||f.attendance_status}</span>}
                {f.content === BASIC_RECEIPT && (
                  <span className="mb-2 inline-block rounded-md bg-primary-50 px-2 py-1 text-xs text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                    上课确认
                  </span>
                )}
                <p className="line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  {f.performance || f.content || f.summary || "老师已发布课堂反馈"}
                </p>
                <Button
                  variant="ghost"
                  className="mt-2 px-0 text-primary-700 dark:text-primary-300 "
                  onClick={() => setDetail(f)}
                >
                  查看上课记录 ›
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
      {detail && (
        <Dialog
          open
          onClose={() => setDetail(null)}
          title="上课记录"
          description={`${detail.teacher_name || "外教老师"} · ${fmtTime(detail.scheduled_at || detail.published_at)}`}
          footer={
            <>
              <Button variant="outline" onClick={() => setDetail(null)}>
                关闭
              </Button>
              <Button asChild>
                <Link to="/parent/messages">给学校留言</Link>
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="rounded-xl bg-primary-50 p-4 dark:bg-primary-950">
              <Section
                label={detail.content === BASIC_RECEIPT ? "上课确认" : "本节上课内容"}
                value={detail.content || detail.summary}
              />
            </div>
            {detail.performance && <Section label="课堂表现" value={detail.performance} />}
            {detail.next_plan && <Section label="课后建议与计划" value={detail.next_plan} />}
            {detail.homework && <div className="rounded-xl border border-primary-100 p-4 dark:border-primary-800"><Section label="课后作业" value={detail.homework} /></div>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
