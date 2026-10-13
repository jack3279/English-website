import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Monitor, Smartphone, Tablet, Globe, Loader2, Trash2, ShieldAlert } from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { useToast } from "../../components/ui/toast.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Dialog } from "../../components/ui/dialog.jsx";

function DeviceIcon({ label }) {
  const l = (label || "").toLowerCase();
  if (l.includes("iphone") || l.includes("ios")) return <Smartphone className="w-5 h-5" />;
  if (l.includes("ipad") || l.includes("android")) return <Tablet className="w-5 h-5" />;
  return <Monitor className="w-5 h-5" />;
}

function relTime(iso) {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const min = Math.floor(d / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export default function SessionsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: async () => (await http("/me/sessions")).data,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];

  const enriched = items;

  const revoke = useMutation({
    mutationFn: (id) => http(`/me/sessions/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      toast.success(
        enriched.find((s) => s.id === id)?.legacy ? "历史记录已撤销" : "该设备的本站登录已退出",
      );
      qc.invalidateQueries({ queryKey: ["me", "sessions"] });
      setConfirmId(null);
      // 如果登的是本机, 强制退出登录态
      const isCurrent = enriched.find((s) => s.id === id)?.is_current;
      if (isCurrent) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("auth:force-logout"));
        }, 500);
      }
    },
    onError: (e) => toast.error(e?.message || "操作失败"),
  });

  return (
    <div className="min-h-full">
      <PageHeader
        icon={ShieldAlert}
        title="登录设备管理"
        subtitle="查看哪些设备正在登录你的账号,可一键远程登出"
      />

      <main className="page-body space-y-4">
        {/* 说明卡 */}
        <Card className="p-4 bg-primary-50/40 dark:bg-primary-900/20 border-primary-200/60 dark:border-primary-800/40">
          <div className="flex gap-2 text-sm text-primary-900 dark:text-primary-200">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              发现不认识的设备，可以退出该设备的本站登录。标为「历史记录」的旧版记录只会停止对应令牌续签；如发现异常，请同时修改密码并核对账号。
            </div>
          </div>
        </Card>

        {isLoading ? (
          <Card className="p-12 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 加载中…
          </Card>
        ) : error ? (
          <Card className="p-5">
            <p role="alert">登录设备加载失败，请重试。</p>
            <Button className="mt-3" variant="outline" onClick={() => refetch()}>
              重新加载
            </Button>
          </Card>
        ) : enriched.length === 0 ? (
          <Card className="p-12 text-center">
            <Globe className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-400 mb-2" />
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">暂无活跃设备</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              重新登录后会出现在这里
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {enriched.map((s) => (
                <li
                  key={s.id}
                  className="px-4 sm:px-5 py-3.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      s.is_current
                        ? "bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    <DeviceIcon label={s.device_label} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {s.device_label}
                      </span>
                      {s.is_current && (
                        <Badge variant="success" className="text-[10px]">
                          本机
                        </Badge>
                      )}
                      {s.legacy && (
                        <Badge variant="secondary" className="text-[10px]">
                          历史记录
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
                      <span>最后活跃 {relTime(s.last_active_at)}</span>
                      {s.ip && <span>· IP {s.ip}</span>}
                      <span>
                        · 登录于{" "}
                        {new Date(s.created_at).toLocaleDateString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmId(s.id)}
                    className="shrink-0 text-destructive-600 border-destructive-200 hover:bg-destructive-50 dark:text-destructive-400 dark:border-destructive-800 dark:hover:bg-destructive-900/30"
                    aria-label={`登出 ${s.device_label}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    {s.legacy ? "撤销记录" : "登出"}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* 确认弹窗 */}
        {confirmId && (
          <ConfirmRevoke
            session={enriched.find((s) => s.id === confirmId)}
            onClose={() => setConfirmId(null)}
            onConfirm={() => revoke.mutate(confirmId)}
            loading={revoke.isPending}
          />
        )}
      </main>
    </div>
  );
}

function ConfirmRevoke({ session, onClose, onConfirm, loading }) {
  if (!session) return null;
  const isCurrent = session.is_current;
  return (
    <Dialog
      open
      onClose={() => {
        if (!loading) onClose();
      }}
      title={session.legacy ? "撤销历史登录记录" : `确认登出「${session.device_label}」`}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive-100 dark:bg-destructive-900/30 text-destructive-600 dark:text-destructive-400 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {isCurrent
                ? "这是你当前正在使用的设备。登出后立即跳到登录页,需要重新输入密码。"
                : session.legacy
                  ? "这是旧版历史记录，撤销后停止对应令牌续签；如怀疑账号异常，请同时修改密码。"
                  : "该设备后续访问本站或续签登录时会被拒绝，需要重新登录。"}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className="bg-destructive-600 hover:bg-destructive-700 text-white"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-1" />
            )}
            确认登出
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
