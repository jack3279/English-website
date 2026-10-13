import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Loading } from "../../components/ui/loading.jsx";
import { Link } from "react-router-dom";

function avatarColor(name) {
  const tones = [
    "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 ",
    "bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300 ",
    "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 ",
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ",
    "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300 ",
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ",
  ];
  let hash = 0;
  for (let i = 0; i < (name || "?").length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return tones[hash % tones.length];
}

export default function AlertsPage() {
  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["alerts", "daily"],
    queryFn: async () => (await http("/alerts")).data,
    refetchInterval: 60000,
  });
  const lowBalance = [...(report?.zero_balance ?? []), ...(report?.low_balance ?? [])];

  return (
    <div className="min-h-full">
      <PageHeader
        icon={AlertTriangle}
        title="提醒中心"
        subtitle={
          report ? (
            <span>
              共 {lowBalance.length} 名需关注学员 · {report.zero_balance?.length ?? 0} 名无课时
            </span>
          ) : isError ? (
            "加载失败"
          ) : (
            "加载中…"
          )
        }
      />

      <main className="page-body space-y-6">
        {/* 低余额预警 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning-500" />
                课时余量预警
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-0.5">
                学员剩余课时低于 3 小时, 提醒教务联系家长续费。
              </p>
            </div>
            <Badge variant={lowBalance.length === 0 ? "success" : "warning"}>
              {lowBalance.length} 名
            </Badge>
          </div>

          {isLoading ? (
            <Loading />
          ) : isError ? (
            <Card className="p-6" role="alert">
              课时预警加载失败，请稍后重试。
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 text-primary-700 underline dark:text-primary-300 "
              >
                重试
              </button>
            </Card>
          ) : lowBalance.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-success-50 flex items-center justify-center mb-2 dark:bg-success-900/25 ">
                <CheckCircle2 className="w-6 h-6 text-success-500" />
              </div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                所有学员课时充足 🎉
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 mt-1">
                无需续费提醒
              </div>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <ul className="divide-y divide-gray-100 dark:divide-gray-800 ">
                {lowBalance.map((s) => {
                  const empty = (s.remaining_hours ?? 0) === 0;
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/students/${s.id}`}
                        className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 dark:bg-gray-950 transition dark:hover:bg-gray-800/40 "
                      >
                        <div
                          className={`w-10 h-10 rounded-full font-semibold flex items-center justify-center flex-shrink-0 ${avatarColor(s.full_name)}`}
                        >
                          {(s.full_name || "?").charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {s.full_name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                            <Package className="w-3 h-3" />
                            学员 ID: {s.id.slice(0, 8)}…
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-lg font-bold ${
                              empty
                                ? "text-danger-600 dark:text-danger-300 "
                                : "text-warning-600 dark:text-warning-300 "
                            }`}
                          >
                            {s.remaining_hours ?? 0}
                            <span className="text-xs font-normal text-gray-500 dark:text-gray-400 dark:text-gray-400 ml-1">
                              h
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {empty ? "已无课时" : "低于 3 小时"}
                          </div>
                        </div>
                        <span className="text-xs text-primary-700 hover:underline shrink-0 ml-3 dark:text-primary-300 ">
                          处理 →
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>

        {/* 提示 */}
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2">
          每 60 秒自动刷新 · 余额包含已购课时、消课及课时调整
        </div>
      </main>
    </div>
  );
}
