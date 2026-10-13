import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseBackup,
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Download,
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
} from "lucide-react";
import { http } from "../../lib/http.js";
import { Card } from "../../components/ui/card.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { useToast } from "../../components/ui/toast.jsx";

function bytes(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// 表名 -> 中文。恢复页给教务看, 摆一屏 snake_case 英文表名看得人发懵。
const TABLE_LABEL = {
  branches: "校区",
  profiles: "用户档案",
  students: "学员",
  teachers: "教师",
  parents: "家长",
  parent_student_links: "家长-学员关联",
  package_types: "课时包类型",
  student_packages: "学员课时包",
  package_payments: "缴费记录",
  courses: "课程",
  lessons: "课节",
  records: "课后反馈正文",
  parent_feeds: "课后反馈(家长可见)",
  lesson_transactions: "课时流水",
  leave_requests: "请假申请",
  makeups: "补课记录",
  notifications: "站内通知",
  notification_reads: "通知已读标记",
  announcements: "公告",
  materials: "教材资料",
  internal_messages: "站内信",
  leads: "招生线索",
  reminder_log: "提醒发送记录",
  audit_log: "操作日志",
};

const label = (t) => TABLE_LABEL[t] ?? t;

export default function BackupsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [password, setPassword] = useState('');
  const [privatePlan, setPrivatePlan] = useState(null);

  const { data: list, isLoading, error: listError } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await http("/backups")).data,
    refetchInterval: 120000,
  });

  const activeDate = date || list?.items?.[0]?.date || "";
  const { data: summary } = useQuery({
    queryKey: ['backups', 'summary', activeDate],
    queryFn: async () => (await http(`/backups/${activeDate}`)).data,
    enabled: Boolean(activeDate),
  });
  const createBackup = useMutation({
    mutationFn: async () => (await http('/backups/create', { method: 'POST' })).data,
    onSuccess: (r) => { toast[r.complete ? 'success' : 'warning'](r.complete ? '备份已生成，数据库与私有数据均已保存' : '备份存在未完整导出的内容，请查看状态'); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: e => toast.error(e.message || '备份失败'),
  });
  const verifyBackup = useMutation({
    mutationFn: async () => (await http(`/backups/${activeDate}/verify`, { method: 'POST' })).data,
    onSuccess: r => { toast.success(`私有数据恢复演练通过：${r.privateObjects} 个对象逐个读回一致`); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: e => toast.error(e.message || '恢复演练失败'),
  });
  const privateRestore = useMutation({
    mutationFn: async (dryRun) => (await http(`/backups/${activeDate}/private-restore`, { method: 'POST', body: { dryRun, current_password: dryRun ? undefined : password } })).data,
    onSuccess: r => { setPrivatePlan(r); if (!r.dryRun) { setPassword(''); toast.success(`已补回 ${r.inserted} 个私有对象`); } },
    onError: e => toast.error(e.message || '私有数据恢复失败'),
  });

  const { data: diff, isLoading: diffLoading } = useQuery({
    queryKey: ["backups", "diff", activeDate],
    queryFn: async () => (await http(`/backups/${activeDate}/diff`)).data,
    enabled: Boolean(activeDate),
  });

  const rows = useMemo(() => {
    const all = diff?.tables ?? [];
    if (!all.length) return [];
    return [...all].sort((a, b) => (b.missing || 0) - (a.missing || 0));
  }, [diff]);

  const totalMissing = diff?.totalMissing ?? 0;
  const blockedCount = rows.filter((r) => r.blocked).length;

  const restore = useMutation({
    mutationFn: async (dryRun) =>
      (
        await http(`/backups/${activeDate}/restore`, {
          method: "POST",
          body: { dryRun, current_password: dryRun ? undefined : password },
        })
      ).data,
    onSuccess: (res) => {
      setLastResult(res);
      if (!res.dryRun) setPassword('');
      if (res.dryRun) toast.info(`预览：将补回 ${res.totalPlanned} 行，未写入任何数据`);
      else if (res.failed > 0) toast.warning(`补回 ${res.inserted} 行，${res.failed} 行失败`);
      else toast.success(`已补回 ${res.inserted} 行`);
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    // 没有这段的话, 恢复失败时页面什么都不会出现 —— 点一下、没反应,
    // 最容易被当成"按钮点不动"。
    onError: (e) => toast.error(e?.message || "恢复失败，请稍后重试"),
  });

  // 恢复虽然只补缺失行、不删数据, 但仍是写库操作。按项目里删学员/删课时包的惯例
  // 加一次 confirm, 避免误点。
  const confirmRestore = () => {
    const n = diff?.totalMissing ?? 0;
    if (
      confirm(
        `将从 ${activeDate} 的备份补回 ${n} 行缺失数据？\n\n` +
          `只会新增「备份里有、现在没有了」的行，不会修改也不会删除现有数据。\n` +
          `同一份备份重复执行不会多写。`,
      )
    ) {
      restore.mutate(false);
    }
  };

  // 下载必须走 http(): 备份接口要求管理员 JWT, 直接 window.open 不会带 token,
  // 只会拿到 401。
  const download = async () => {
    const raw = await http(`/backups/${activeDate}/download`);
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-${activeDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-full">
        <PageHeader back="/admin" icon={DatabaseBackup} title="数据备份与恢复" subtitle="加载中…" />
        <main className="page-body text-sm text-gray-500 dark:text-gray-400 ">
          正在读取备份列表…
        </main>
      </div>
    );
  }

  if (list && list.bound === false) {
    return (
      <div className="min-h-full">
        <PageHeader icon={DatabaseBackup} title="数据备份与恢复" subtitle="未绑定 R2" />
        <main className="page-body">
          <Card className="p-6 border-amber-300 bg-amber-50 dark:bg-amber-950/40">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
                <p className="font-medium">Worker 没有绑定 R2 存储桶，所以目前根本没在产生备份。</p>
                <p>{list.hint}</p>
                <p>需要在 wrangler.toml 里配置 r2_buckets 并重新部署 Worker。</p>
              </div>
            </div>
          </Card>
        </main>
      </div>
    );
  }
  if (listError) return <div className="page-body"><p role="alert">无法读取备份：{listError.message}</p></div>;

  return (
    <div className="min-h-full">
      <PageHeader
        icon={DatabaseBackup}
        title="数据备份与恢复"
        subtitle={
          list?.items?.length
            ? `${list.items.length} 份可用备份 · 最新 ${list.items[0].date}`
            : "还没有任何备份"
        }
      />

      <main className="page-body space-y-6">
        <Card className="p-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">每日北京时间 02:30 自动备份。重要操作前可立即备份；生成期间尽量暂停录入。</p>
          <Button onClick={() => createBackup.mutate()} disabled={createBackup.isPending}>{createBackup.isPending ? '正在备份…' : '立即生成备份'}</Button>
          {list?.lastAttempt?.complete === false && <p role="alert" className="text-sm text-red-700 dark:text-red-300">最近一次备份未完整完成（{new Date(list.lastAttempt.at).toLocaleString('zh-CN')}）。请重新生成；原有完整备份已保留。</p>}
          {summary && <div className="text-sm space-y-2 text-gray-700 dark:text-gray-300">
            <div className="flex flex-wrap items-center gap-2">
              <span>所选备份：{summary.version} · {summary.complete ? '导出完整、校验通过' : '旧格式或导出不完整，请生成新备份'}</span>
              <Badge variant={summary.encrypted ? 'success' : 'warning'}>{summary.encrypted ? '整库已加密' : '历史明文备份'}</Badge>
            </div>
            <p>业务表 {summary.tables?.length || 0} 张 · 私有数据 {summary.private?.count || 0} 个 · 账号元数据 {summary.auth?.count || 0} 条</p>
            {!summary.encrypted && <p className="text-amber-700 dark:text-amber-300">这份历史备份下载后是明文 JSON；新生成的备份会使用 AES-GCM 信封加密。</p>}
            {!summary.private?.ok && <p className="text-amber-700 dark:text-amber-300">{summary.private?.error}</p>}
            <p>数据库归档和私有数据均包含手机号、薪酬等敏感信息；新加密备份下载到的是加密信封。</p>
            <p>密码、登录会话和部署密钥不在备份内。恢复加密数据需要原加密主密钥；外部教材及图片仅保存链接。</p>
            <Button variant="secondary" disabled={!summary.complete || verifyBackup.isPending} onClick={() => verifyBackup.mutate()}>{verifyBackup.isPending ? '正在演练…' : '验证私有数据恢复'}</Button>
            {summary.drill && <p>最近私有数据演练：{new Date(summary.drill.at).toLocaleString('zh-CN')}，{summary.drill.privateObjects} 个对象恢复读回通过。数据库演练另在隔离数据库执行。</p>}
          </div>}
        </Card>
        {!list?.items?.length ? (
          <Card className="p-6 text-sm text-gray-600 dark:text-gray-300">
            还没有备份。请点击“立即生成备份”，完成后查看完整性状态。
          </Card>
        ) : (
          <>
            {/* 恢复立场 —— 必须先讲清楚，否则有人会以为这是「一键回滚」 */}
            <Card className="p-4 border-slate-200 dark:border-slate-800">
              <div className="flex gap-3">
                <ShieldAlert className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1.5">
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    这里的「恢复」是补回被删的行，不是回滚
                  </p>
                  <p>
                    系统会比对备份与当前数据库，只把「备份里有、现在没有了」的行补回来，
                    <b>不会覆盖也不会删除</b>备份之后新产生的数据。
                  </p>
                  <p className="text-gray-500 dark:text-gray-400">
                    登录账号（Supabase Auth）不在备份范围内：如果某个账号连 Auth 用户一起被删了，
                    数据补回来也无法登录，需要在 Supabase Auth 控制台重建账号。
                  </p>
                </div>
              </div>
            </Card>

            {/* 选择备份 */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400 mr-1">选择备份：</span>
                {(list.items ?? []).slice(0, 14).map((it) => (
                  <button
                    key={it.date}
                    onClick={() => {
                      setDate(it.date);
                      setLastResult(null);
                      setPrivatePlan(null);
                      setPassword('');
                    }}
                    className={`text-sm px-3 h-9 rounded-md border transition-colors ${
                      activeDate === it.date
                        ? "border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                        : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 "
                    }`}
                  >
                    {it.date}
                    <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400 ">
                      {bytes(it.size)}
                    </span>
                  </button>
                ))}
                <Button variant="ghost" size="sm" onClick={download} className="ml-auto">
                  <Download className="w-4 h-4 mr-1.5" />
                  下载这份 JSON
                </Button>
              </div>
            </Card>

            {/* 差异表 */}
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-gray-500 dark:text-gray-400 " />
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {activeDate} 与当前数据库比对
                  </h2>
                </div>
                {totalMissing > 0 ? (
                  <Badge variant="warning">{totalMissing} 行可补回</Badge>
                ) : (
                  <Badge variant={blockedCount ? 'warning' : 'success'}>{blockedCount ? '部分表未能比对' : '无缺失'}</Badge>
                )}
              </div>

              {diffLoading ? (
                <p className="p-6 text-sm text-gray-500 dark:text-gray-400 ">正在比对…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>数据表</TableHead>
                      <TableHead className="text-right">备份中</TableHead>
                      <TableHead className="text-right">当前库</TableHead>
                      <TableHead className="text-right">缺失</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.table}>
                        <TableCell className="font-medium text-gray-900 dark:text-gray-100">
                          {label(r.table)}
                          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400 ">
                            {r.table}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.backupRows}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.dbRows ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.blocked ? (
                            <span className="text-gray-500 dark:text-gray-400 ">—</span>
                          ) : (
                            <b
                              className={
                                r.missing > 0
                                  ? "text-amber-600"
                                  : "text-gray-500 dark:text-gray-400 "
                              }
                            >
                              {r.missing}
                            </b>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 dark:text-gray-400">
                          {r.blocked ? (
                            <span className="text-red-600 dark:text-red-400">{r.reason}</span>
                          ) : r.truncated ? (
                            <span className="text-amber-600">这份备份该表当时被截断，可能不全</span>
                          ) : !r.verified ? (
                            <span>旧格式备份，无完整性记录</span>
                          ) : r.missing > 0 ? (
                            `备份里有 ${r.missing} 行现在查不到`
                          ) : (
                            "一致"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            {/* 操作 */}
            <Card className="p-4">
              <label className="block text-sm mb-3 text-gray-700 dark:text-gray-300">当前管理员密码（实际恢复时验证）
                <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full max-w-sm rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2" />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={restore.isPending || !activeDate}
                  onClick={() => restore.mutate(true)}
                >
                  {restore.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  预览这次会补回什么
                </Button>
                <Button disabled={restore.isPending || totalMissing === 0 || !password} onClick={confirmRestore}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  确认恢复 {totalMissing > 0 ? `${totalMissing} 行` : ""}
                </Button>
                {blockedCount > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 ">
                    {blockedCount} 张表不可恢复，已跳过
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                先预览、再恢复。恢复是幂等的：同一份备份重复执行不会多写一行。
              </p>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                <Button variant="secondary" disabled={!summary?.complete || privateRestore.isPending} onClick={() => privateRestore.mutate(true)}>预览私有数据恢复</Button>
                {privatePlan && <span className="text-sm">缺失 {privatePlan.missing} 个，现有 {privatePlan.existing} 个保持不变</span>}
                {privatePlan?.dryRun && privatePlan.missing > 0 && <Button disabled={!password || privateRestore.isPending} onClick={() => { if (confirm(`补回 ${privatePlan.missing} 个缺失的私有对象？现有设置保持不变。`)) privateRestore.mutate(false); }}>确认补回私有数据</Button>}
              </div>
            </Card>

            {lastResult && (
              <Card className="p-4 border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30">
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1.5">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {lastResult.dryRun ? "预览结果" : lastResult.failed || lastResult.blocked?.length || lastResult.remaining ? "恢复结果（仍有待处理内容）" : "恢复完成"}
                    </p>
                    {lastResult.dryRun ? (
                      <p className="text-gray-700 dark:text-gray-300">
                        将补回 {lastResult.totalPlanned} 行，当前库缺失 {lastResult.totalMissing}{" "}
                        行。 这是预览，没有动过任何数据。
                      </p>
                    ) : (
                      <>
                        <p className="text-gray-700 dark:text-gray-300">
                          已补回 {lastResult.inserted} 行
                          {lastResult.failed > 0 && (
                            <span className="text-red-600">，{lastResult.failed} 行失败</span>
                          )}
                          {lastResult.remaining > 0 && (
                            <span>
                              ，还剩 {lastResult.remaining} 行请再点一次（单次要控制资源消耗）
                            </span>
                          )}
                        </p>
                        {(lastResult.results ?? [])
                          .filter((r) => r.failed > 0)
                          .map((r) => (
                            <p key={r.table} className="text-xs text-red-600 dark:text-red-400">
                              {label(r.table)}：
                              {r.failures.map((f) => `${f.id} (${f.error})`).join("；")}
                            </p>
                          ))}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {lastResult.caveat}
                        </p>
                        {lastResult.blocked?.length > 0 && <p className="text-amber-700 dark:text-amber-300">{lastResult.blocked.length} 张表未能安全恢复，请检查备份或逐表处理。</p>}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
