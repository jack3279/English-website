// 企业微信逐人提醒通道 —— 零新增依赖, 仅用 Worker 自带的 fetch。
//
// 两类消息:
//   1) 应用消息   (message/send)                    -> 机构内部成员(老师/员工), 用 teachers.wecom_user_id
//   2) 客户联系   (externalcontact/message/send)     -> 家长(外部联系人), 用 parents.wecom_external_user_id
//
// 凭证来自 Worker secrets (不入库、不写死):
//   WECHAT_CORP_ID            企业 ID
//   WECHAT_CORP_SECRET        自建应用 Secret (应用消息用)
//   WECHAT_AGENT_ID           应用 AgentId
//   WECHAT_EXTCONTACT_SECRET  客户联系 Secret (家长消息用, 可选)
//
// 未配置凭证时所有发送优雅跳过 (返回 { skipped: true }), 绝不影响主流程与 Cron。
//
// 设计约束 (Workers Free):
//   - fetch 等待网络不计入 CPU 10ms, 可以放心调用;
//   - 但子请求上限 50/请求, 故所有批量发送都必须经过 cap, 见下方 MAX_PUSH_PER_RUN;
//   - token 缓存在模块作用域 (isolate 内有效), 冷启动会重新取一次, 属预期行为。

const { warn } = require("../lib/log.js");

// 单次任务最多推送多少人, 防止子请求超限 (免费档 50 子请求/请求)
const MAX_PUSH_PER_RUN = 20;

// 令牌提前 30s 过期, 避免临界失效
const TOKEN_SAFETY_MS = 30_000;
const TIMEOUT_MS = 5_000;

// 按 secret 区分 (应用 / 客户联系), 模块作用域缓存
const tokenCache = new Map();

function currentEnv() {
  return globalThis.__CLOUDFLARE_ENV || process.env;
}

function getWeComConfig() {
  const env = currentEnv();
  return {
    corpId: String(env.WECHAT_CORP_ID || "").trim(),
    appSecret: String(env.WECHAT_CORP_SECRET || "").trim(),
    agentId: String(env.WECHAT_AGENT_ID || "").trim(),
    extSecret: String(env.WECHAT_EXTCONTACT_SECRET || "").trim(),
  };
}

// 应用消息(老师)是否可用
function appEnabled() {
  const c = getWeComConfig();
  return Boolean(c.corpId && c.appSecret && c.agentId);
}

// 客户联系消息(家长)是否可用
function extEnabled() {
  const c = getWeComConfig();
  return Boolean(c.corpId && c.extSecret);
}

async function fetchJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function getToken(corpId, secret) {
  const key = `${corpId}:${secret}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MS) return cached.token;

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
    corpId,
  )}&corpsecret=${encodeURIComponent(secret)}`;
  const res = await fetchJson(url);
  if (res.body && res.body.access_token) {
    tokenCache.set(key, {
      token: res.body.access_token,
      expiresAt: Date.now() + (Number(res.body.expires_in) || 7200) * 1000,
    });
    return res.body.access_token;
  }
  throw new Error((res.body && res.body.errmsg) || "获取企业微信 access_token 失败");
}

// 应用消息: 发给机构内部成员(老师/员工)
async function sendAppMessage(touser, content) {
  if (!touser) return { ok: false, skipped: true, reason: "no_touser" };
  if (!appEnabled()) return { ok: false, skipped: true, reason: "app_not_configured" };
  const c = getWeComConfig();
  try {
    const token = await getToken(c.corpId, c.appSecret);
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const res = await fetchJson(url, {
      touser,
      msgtype: "text",
      agentid: Number(c.agentId),
      text: { content },
    });
    const ok = Boolean(res.body && res.body.errcode === 0);
    if (!ok)
      warn("wecom_app_send_failed", { errcode: res.body?.errcode, errmsg: res.body?.errmsg });
    return { ok, ...res.body };
  } catch (error) {
    warn("wecom_app_send_error", { err: error.message });
    return { ok: false, error: error.message };
  }
}

// 客户联系消息: 发给家长(外部联系人)
async function sendExternalMessage(externalUserId, content) {
  if (!externalUserId) return { ok: false, skipped: true, reason: "no_external_userid" };
  if (!extEnabled()) return { ok: false, skipped: true, reason: "ext_not_configured" };
  const c = getWeComConfig();
  try {
    const token = await getToken(c.corpId, c.extSecret);
    const url = `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/message/send?access_token=${token}`;
    const res = await fetchJson(url, {
      to_external_userid: [externalUserId],
      msgtype: "text",
      text: { content },
    });
    const ok = Boolean(res.body && res.body.errcode === 0);
    if (!ok)
      warn("wecom_ext_send_failed", { errcode: res.body?.errcode, errmsg: res.body?.errmsg });
    return { ok, ...res.body };
  } catch (error) {
    warn("wecom_ext_send_error", { err: error.message });
    return { ok: false, error: error.message };
  }
}

// ---------- 文案 ----------

function fmtWhen(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function lessonContent({ studentName, teacherName, scheduledAt, meetingUrl, hoursAhead = 24 }) {
  const join = meetingUrl ? `\n入会链接：${meetingUrl}` : "";
  return `上课提醒：${studentName || "学员"} 将于 ${fmtWhen(scheduledAt)} 上 ${
    teacherName || "老师"
  } 的课（约 ${hoursAhead} 小时后），请提前准备。${join}`;
}

function renewalContent({ packageName, balance, total, expiresAt, stage }) {
  if (stage === "expiring") {
    const day = expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "";
    return `课时包「${packageName || ""}」将于 ${day} 到期（剩余 ${balance} 小时），请及时续费。`;
  }
  return `课时包「${packageName || ""}」剩余 ${balance} 小时（共 ${total} 小时），建议尽快续费，避免影响上课。`;
}

// ---------- 批量发送 ----------

// 并发跑一批发送任务, 全部兜底不抛, 并统计成功数。
// 返回 { attempted, sent, skipped, failed }
async function runBatch(jobs) {
  const capped = jobs.slice(0, MAX_PUSH_PER_RUN);
  const results = await Promise.all(
    capped.map((p) => Promise.resolve(p).catch(() => ({ ok: false }))),
  );
  return {
    attempted: capped.length,
    truncated: Math.max(0, jobs.length - capped.length),
    sent: results.filter((r) => r && r.ok).length,
    skipped: results.filter((r) => r && r.skipped).length,
    failed: results.filter((r) => r && !r.ok && !r.skipped).length,
  };
}

// 上课提醒: 老师走应用消息, 该学员的家长走客户联系
function lessonReminderJobs({ lesson, teacherWecomId, parentWecomIds }) {
  const text = lessonContent(lesson);
  const jobs = [];
  if (teacherWecomId) jobs.push(sendAppMessage(teacherWecomId, text));
  for (const id of parentWecomIds ?? []) {
    if (id) jobs.push(sendExternalMessage(id, text));
  }
  return jobs;
}

// 续费提醒: 发给该学员的家长(外部联系人)
function renewalJobs({ alert, parentWecomIds }) {
  const text = renewalContent(alert);
  return (parentWecomIds ?? []).filter(Boolean).map((id) => sendExternalMessage(id, text));
}

// ---------- 通用 helper (事件触发的实时推送) ----------

// 课堂反馈: 完成课节时推给家长
function classReportContent({ studentName, teacherName, scheduledAt, durationMin, summary }) {
  const when = fmtWhen(scheduledAt);
  return (
    `${studentName || "学员"} ${when} 与 ${teacherName || "老师"} 的课（${durationMin || "?"} 分钟）已结束。\n` +
    `课堂反馈：${summary || "（老师未填写）"}`
  );
}

// 课改期: 给家长一条改期通知
function lessonChangedContent({ studentName, fromAt, toAt, changeNote = "" }) {
  const from = fmtWhen(fromAt);
  const to = fmtWhen(toAt);
  return `${studentName || "学员"} 的课从 ${from} 改到 ${to}${changeNote},请按新时间参加。`;
}

// 课取消: 给家长一条取消通知
function lessonCancelledContent({ studentName, scheduledAt, durationMin }) {
  const when = fmtWhen(scheduledAt);
  return `${studentName || "学员"} ${when} 的课（${durationMin || "?"} 分钟）已取消,后续补课安排另行通知。`;
}

// 通用: 把一段文本广播给一组家长 (external contact), 返回 Promise job 列表
function textToParentsJobs(parentWecomIds, content) {
  return (parentWecomIds ?? []).filter(Boolean).map((id) => sendExternalMessage(id, content));
}

// 通用: 把一段文本广播给一组企业内部成员 (老师/管理员)
function textToStaffJobs(staffUserIds, content) {
  return (staffUserIds ?? []).filter(Boolean).map((id) => sendAppMessage(id, content));
}

// 事件类推送的 job 工厂: 课堂反馈
function classReportJobs({ parentWecomIds, payload }) {
  return textToParentsJobs(parentWecomIds, classReportContent(payload));
}

// 事件类推送的 job 工厂: 改期
function lessonChangedJobs({ parentWecomIds, payload }) {
  return textToParentsJobs(parentWecomIds, lessonChangedContent(payload));
}

// 事件类推送的 job 工厂: 取消
function lessonCancelledJobs({ parentWecomIds, payload }) {
  return textToParentsJobs(parentWecomIds, lessonCancelledContent(payload));
}

module.exports = {
  MAX_PUSH_PER_RUN,
  getWeComConfig,
  appEnabled,
  extEnabled,
  sendAppMessage,
  sendExternalMessage,
  runBatch,
  lessonContent,
  renewalContent,
  classReportContent,
  lessonChangedContent,
  lessonCancelledContent,
  lessonReminderJobs,
  renewalJobs,
  classReportJobs,
  lessonChangedJobs,
  lessonCancelledJobs,
  textToParentsJobs,
  textToStaffJobs,
};
