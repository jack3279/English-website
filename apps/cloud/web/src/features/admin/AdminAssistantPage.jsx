import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Bot, Save, Send, Pause, RefreshCw } from "lucide-react";
import { http } from "../../lib/http.js";
import { financialRequest } from "../../lib/financialRequest.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Label } from "../../components/ui/label.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
const defaults = {
  enabled: false,
  consent: false,
  includeNames: false,
  budgetYuan: 20,
  dailyLimit: 20,
  reminders: false,
  lessonReminders: false,
  lessonReminderMinutes: 30,
  reminderTimes: ["10:00", "17:00"],
};
export default function AdminAssistantPage() {
  const qc = useQueryClient(),
    query = useQuery({
      queryKey: ["admin-bot", "settings"],
      queryFn: async () => (await http("/admin-bot/settings")).data,
      refetchInterval: 15000,
    });
  const data = query.data,
    [form, setForm] = useState(defaults),
    [key, setKey] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [initialized, setInitialized] = useState(false);
  const [pair, setPair] = useState(null),
    [qrImage, setQrImage] = useState(""),
    [qrStatus, setQrStatus] = useState(""),
    [bindText, setBindText] = useState(""),
    [verification, setVerification] = useState("");
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState("");
  useEffect(() => {
    if (data && !initialized) {
      setForm(Object.fromEntries(Object.keys(defaults).map((k) => [k, data[k] ?? defaults[k]])));
      setInitialized(true);
    }
  }, [data, initialized]);
  useEffect(() => {
    if (data?.binding) {
      setPair(data.binding);
      setQrStatus(data.binding.status);
      setBindText(data.binding.bindText || "");
    }
  }, [data?.binding?.id]);
  useEffect(() => {
    let alive = true;
    if (pair?.image)
      QRCode.toDataURL(pair.image, { width: 240, margin: 2 })
        .then((url) => {
          if (alive) setQrImage(url);
        })
        .catch(() => setError("二维码无法显示，请重新生成"));
    return () => {
      alive = false;
    };
  }, [pair]);
  async function run(task) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(e.message || "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin-bot"] });
  }
  async function save(e) {
    e.preventDefault();
    await run(async () => {
      const response = await http("/admin-bot/settings", {
        method: "PATCH",
        body: { ...form, apiKey: key, current_password: password },
      });
      qc.setQueryData(["admin-bot", "settings"], response.data);
      setKey("");
      setPassword("");
      setNotice(
        response.data.enabled
          ? "设置已保存，微信机器人已启用。"
          : "设置已保存。完成本人微信绑定后，勾选启用并再次保存。",
      );
    });
  }
  async function check(code) {
    if (!pair) return;
    await run(async () => {
      const response = await http("/admin-bot/wechat/state", {
        method: "POST",
        body: { pairId: pair.id, ...(code ? { verification: code } : {}) },
      });
      setQrStatus(response.data.status);
      setBindText(response.data.bindText || "");
      await refresh();
    });
  }
  if (query.isPending) return <Card className="m-5 p-5">正在读取机器人配置…</Card>;
  if (query.isError)
    return (
      <div>
        <PageHeader title="管理员智能助手" icon={Bot} />
        <main className="page-body">
          <Card className="p-5">
            <p role="alert">{query.error.message || "配置加载失败"}</p>
            <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>
              重试
            </Button>
          </Card>
        </main>
      </div>
    );
  return (
    <div className="min-h-full admin-mobile-page">
      <PageHeader
        title="管理员智能助手"
        subtitle="每位管理员独立绑定微信 · 独立对话与提醒"
        icon={Bot}
        actions={
          <Button
            variant="outline"
            disabled={busy || !data.enabled}
            onClick={() =>
              run(async () => {
                const r = await http("/admin-bot/pause", { method: "POST", body: {} });
                qc.setQueryData(["admin-bot", "settings"], r.data);
                setForm((f) => ({ ...f, enabled: false }));
                setNotice("机器人已暂停");
              })
            }
          >
            <Pause className="h-4 w-4" />
            暂停机器人
          </Button>
        }
      />
      <main className="page-body space-y-4">
        <Card className="p-4 text-sm text-gray-600 dark:text-gray-400">
          当前页面只管理你自己的助手。其他管理员请用各自的网站账号登录，在这里分别填写API
          Key、扫码绑定微信和设置提醒。密钥、对话、额度与暂停状态各自独立；可自行填写同一个DeepSeek
          Key共用平台账单。同一个微信只能绑定一个管理员账号。
        </Card>
        {error && (
          <Card
            role="alert"
            className="p-4 border-danger-200 text-danger-700 dark:border-danger-800 dark:text-danger-300 "
          >
            {error}
          </Card>
        )}
        {notice && (
          <Card role="status" className="p-4 text-primary-700 dark:text-primary-300 ">
            {notice}
          </Card>
        )}
        <Card className="p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <strong>{data.enabled ? "已启用" : "未启用"}</strong>
            <span>DeepSeek：{data.keyConfigured ? "已配置" : "待配置"}</span>
            <span>微信：{data.bound ? "已验证本人绑定" : "待绑定"}</span>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 ">
            云端每分钟检查消息，回复可能延迟约1分钟。第一版支持文字和已转写语音；教务操作在网站中完成。
          </p>
          {data.lastError && (
            <p className="mt-2 text-sm text-warning-700 dark:text-warning-300 ">
              运行状态：{data.lastError}
            </p>
          )}
          {data.connectionWarning && (
            <p className="mt-2 text-sm text-warning-700 dark:text-warning-300 ">
              微信启动通知：{data.connectionWarning}
            </p>
          )}
          {data.bindingCheck && !data.bound && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 ">
              最近绑定检查：收到 {data.bindingCheck.received} 条消息，其中本人消息{" "}
              {data.bindingCheck.ownSender} 条，通过身份与类型检查 {data.bindingCheck.accepted}{" "}
              条，绑定码匹配 {data.bindingCheck.codeMatched} 条，带回复凭证{" "}
              {data.bindingCheck.withContext} 条。
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 ">
            预算按当前模型最高单价估算，网络结果未知会保留预留额度；实际费用以DeepSeek账单为准。微信会话失效时需重新发消息或扫码。
          </p>
        </Card>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">1. 配置DeepSeek与工作提醒</h2>
            <form onSubmit={save} className="space-y-4">
              <div>
                <Label htmlFor="bot-key">DeepSeek API Key</Label>
                <Input
                  id="bot-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    data.keyConfigured ? "已保存；留空保留现有密钥" : "在DeepSeek开放平台创建并复制"
                  }
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
                  仅存入服务器加密存储，不回显密钥。模型使用 deepseek-flash，关闭深度思考。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bot-budget">每月估算额度（元）</Label>
                  <Input
                    id="bot-budget"
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={form.budgetYuan}
                    onChange={(e) => setForm({ ...form, budgetYuan: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="bot-daily">每日问答上限（次）</Label>
                  <Input
                    id="bot-daily"
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={form.dailyLimit}
                    onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  className="mt-1"
                />
                <span>
                  允许把我发给机器人的问题、最近6条对话和教务汇总数字发送给DeepSeek生成回答；模型API会按用量计费。
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.includeNames}
                  onChange={(e) => setForm({ ...form, includeNames: e.target.checked })}
                  className="mt-1"
                />
                <span>
                  汇总中包含必要的学员、教师姓名。手机号、地址、会议链接、网站密码和密钥始终不作为教务快照发送。
                </span>
              </label>
              <div className="rounded-xl bg-primary-50 p-4 dark:bg-primary-950">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={form.lessonReminders}
                    onChange={(e) => setForm({ ...form, lessonReminders: e.target.checked })}
                  />
                  课前提醒我联系家长
                </label>
                <div className="mt-3">
                  <Label htmlFor="lesson-reminder-minutes">提前多少分钟（1–180）</Label>
                  <Input
                    id="lesson-reminder-minutes"
                    type="number"
                    min="1"
                    max="180"
                    step="1"
                    required
                    value={form.lessonReminderMinutes}
                    onChange={(e) =>
                      setForm({ ...form, lessonReminderMinutes: Number(e.target.value) })
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 ">
                  仅发送到你绑定的微信，包含学生、教师、课程与上课时间，便于你联系家长。取消的课程跳过，同一课节和开课时间只提交一次，不调用AI。需启用微信机器人并保存设置。
                </p>
                {data.lastLessonReminder && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 ">
                    最近课前提醒：
                    {data.lastLessonReminder.state === "submitted"
                      ? "已提交微信接口"
                      : "发送结果未确认，请查看运行状态"}{" "}
                    ·{" "}
                    {new Date(data.lastLessonReminder.at).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.reminders}
                  onChange={(e) => setForm({ ...form, reminders: e.target.checked })}
                />
                发送仍需处理的事项提醒，没事不发
              </label>
              <div className="grid grid-cols-2 gap-3">
                {form.reminderTimes.slice(0, 2).map((time, i) => (
                  <div key={i}>
                    <Label htmlFor={`bot-time-${i}`}>提醒时间{i + 1}（北京时间）</Label>
                    <Input
                      id={`bot-time-${i}`}
                      type="time"
                      value={time}
                      required
                      onChange={(e) =>
                        setForm({
                          ...form,
                          reminderTimes: form.reminderTimes.map((v, index) =>
                            index === i ? e.target.value : v,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={!data.bound || !data.keyConfigured}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                启用微信机器人
              </label>
              {!data.bound && (
                <p className="text-sm text-warning-700 dark:text-warning-300 ">
                  尚未完成本人微信绑定：扫码后点击“检查扫码状态”，将显示的“绑定
                  XXXXXXXX”发送到微信ClawBot，再点击“我已发送，检查本人绑定”。验证成功后才能勾选启用。
                </p>
              )}
              {data.bound && !data.enabled && (
                <p className="text-sm text-warning-700 dark:text-warning-300 ">
                  本人微信已绑定。勾选“启用微信机器人”，再点击“保存设置”，微信聊天才会开始运行。
                </p>
              )}
              <div>
                <Label htmlFor="bot-password">当前管理员密码</Label>
                <Input
                  id="bot-password"
                  type="password"
                  autoComplete="current-password"
                  required={!data.reauthUntil || data.reauthUntil < Date.now()}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
                  请使用正式管理员账号。首次保存需验证密码，同一登录验证后10分钟内可留空；公开测试初始密码不能配置付费API密钥。
                </p>
              </div>
              <Button type="submit" disabled={busy || !data.storageReady}>
                <Save className="mr-2 h-4 w-4" />
                {busy ? "处理中…" : "保存设置"}
              </Button>
            </form>
          </Card>
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">2. 只绑定你的微信</h2>
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400 ">
                保存设置验证密码后，在10分钟内生成二维码。用自己的微信扫码，再发送网站给出的绑定文字进行本人验证。不会向其他微信账号回复。
              </p>
              <Button
                variant="outline"
                disabled={busy || !data.configured}
                onClick={() =>
                  run(async () => {
                    const r = await http("/admin-bot/wechat/qr", { method: "POST", body: {} });
                    setPair(r.data);
                    setQrStatus("wait");
                    setBindText("");
                    setNotice("二维码已生成，请在微信扫码确认");
                  })
                }
              >
                生成微信绑定二维码
              </Button>
              {qrImage && (
                <div className="mt-4 flex flex-col items-center gap-3">
                  <img
                    src={qrImage}
                    width="240"
                    height="240"
                    alt="用本人微信扫码绑定管理员机器人"
                  />
                  <Button variant="outline" disabled={busy} onClick={() => check()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    检查扫码状态
                  </Button>
                  <p className="text-xs text-gray-500 dark:text-gray-400 ">
                    状态：
                    {{
                      wait: "等待扫码",
                      scaned: "已扫码，请在手机确认",
                      awaiting_code: "请发送绑定文字",
                      expired: "二维码已过期",
                      need_verifycode: "需要手机验证码",
                      verify_code_blocked: "验证码尝试过多，请刷新",
                      bound: "已验证本人绑定",
                      binded_redirect: "检测到已有绑定，请核对现有状态",
                    }[qrStatus] || qrStatus}
                  </p>
                </div>
              )}
              {qrStatus === "need_verifycode" && (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="wechat-code">微信手机上显示的验证码</Label>
                  <Input
                    id="wechat-code"
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    autoComplete="one-time-code"
                  />
                  <Button disabled={busy || !verification} onClick={() => check(verification)}>
                    提交手机验证码
                  </Button>
                </div>
              )}
              {bindText && (
                <div className="mt-3 rounded-xl bg-primary-50 p-4 text-sm dark:bg-primary-950">
                  <p>请在自己的微信ClawBot对话中发送：</p>
                  <strong className="my-2 block text-xl">{bindText}</strong>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const checked = await http("/admin-bot/sync", { method: "POST", body: {} });
                        if (checked.data.bindingConfirmed) {
                          setQrStatus("bound");
                          setBindText("");
                          setPair(null);
                          setQrImage("");
                        }
                        await refresh();
                        setNotice(
                          checked.data.bindingConfirmed
                            ? "本人微信绑定已完成。请勾选启用微信机器人，再保存设置。"
                            : checked.data.busy
                              ? "云端正在检查消息，请稍后刷新绑定状态。"
                              : checked.data.cooldown
                                ? "微信会话已失效，当前处于暂停检查期，请重新扫码绑定。"
                                : checked.data.disabled
                                  ? "当前绑定已结束或过期，请刷新状态；未绑定时重新生成二维码。"
                                  : checked.data.error
                                    ? "绑定检查失败，请查看顶部运行状态。"
                                    : "尚未确认绑定。请查看最近绑定检查结果，发送当前绑定文字后再检查。",
                        );
                      })
                    }
                  >
                    我已发送，检查本人绑定
                  </Button>
                </div>
              )}
              <a
                className="mt-4 inline-block text-xs text-primary-700 underline dark:text-primary-300 "
                href="https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                微信官方ClawBot说明
              </a>
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">3. 网站内测试问答</h2>
              <Button
                variant="outline"
                className="mb-3"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setPreview((await http("/admin-bot/snapshot")).data);
                  })
                }
              >
                检查教务数据（不调用AI）
              </Button>
              {preview && (
                <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800">
                  <p>快照时间：{preview.asOf}</p>
                  <p>
                    待关注事项：
                    {Object.values(preview.needsAttention || {}).reduce(
                      (sum, n) => sum + Number(n),
                      0,
                    )}{" "}
                    项（各分类可能涉及同一学员）
                  </p>
                  <p>
                    今日与明日课节：{preview.lessonCount ?? preview.tomorrowAndToday?.length ?? 0}{" "}
                    节
                  </p>
                </div>
              )}
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400 ">
                先保存API Key与数据授权。测试会调用DeepSeek，计入次数和估算额度。
              </p>
              <Textarea
                aria-label="向管理员助手提问"
                maxLength={1000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：今天有哪些需要我关注的事情？"
                rows={3}
              />
              <Button
                className="mt-3"
                disabled={busy || !question.trim() || !data.keyConfigured || !data.consent}
                onClick={() =>
                  run(async () => {
                    const r = await financialRequest("/admin-bot/ask", {
                      question: question.trim(),
                    });
                    setAnswer(r.data.reply);
                    await refresh();
                  })
                }
              >
                <Send className="mr-2 h-4 w-4" />
                提问
              </Button>
              {answer && (
                <div className="mt-4 whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
                  {answer}
                </div>
              )}
            </Card>
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-semibold">用量与最近对话</h2>
              <p>
                估算用量：¥{((data.usage?.usedMicros || 0) / 1e6).toFixed(4)} / ¥{data.budgetYuan}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ">
                计数日期：{data.usage?.day || "尚无调用"} · 问答 {data.usage?.calls || 0} 次
              </p>
              {(data.history || []).map((m, i) => (
                <div
                  key={i}
                  className="mt-3 whitespace-pre-wrap border-t border-gray-100 pt-3 dark:border-gray-800"
                >
                  <strong className="text-xs">{m.role === "user" ? "你" : "助手"}</strong>
                  <p className="mt-1 text-sm">{m.content}</p>
                </div>
              ))}
              <Button
                className="mt-3"
                variant="outline"
                disabled={busy || !data.history?.length}
                onClick={() =>
                  run(async () => {
                    await http("/admin-bot/history/clear", { method: "POST", body: {} });
                    await refresh();
                  })
                }
              >
                清空最近对话
              </Button>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
