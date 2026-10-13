// Workers Cron 定时任务 (免费档 5 个/账号, CPU 10ms/次)
// 1) keepAlive         - 每天访问一次 DB, 防 Supabase 免费档 7 天不活跃自动暂停
// 2) lessonReminders   - 提前 24h 给家长/老师发上课提醒 (站内通知 + 企业微信)
// 3) renewalReminders  - 扫描课时包余量不足/即将到期, 提醒家长续费 (站内通知 + 企业微信)
// 4) backupToR2        - 每天导出核心表 JSON 到 R2 (免费档无自动备份)
//
// 所有任务必须幂等 + 轻量; 重活(如 xlsx 导出)不要放这里。
// 子请求预算: 免费档 50 子请求/请求 —— 所有查询都必须批量做, 禁止在循环里逐条查库。

const { getAdmin } = require("../lib/supabase.js");
const wecom = require("./wecom.js");
const { getSettings, DEFAULTS: INSTITUTION_DEFAULTS } = require("../lib/institutionSettings.js");

// 备份表清单/上限的唯一来源 —— 与恢复流程(routes/backups.js)共用同一份,
// 避免两边各自维护导致「备份里有啥」说不清。
const BACKUP_TABLES = require("../lib/backup.js").TABLES;
const SHANGHAI_OFFSET = 8 * 3600 * 1000;

// wrangler.toml 里配置的 cron 表达式 (与 event.cron 匹配)
const CRON_KEEPALIVE = "0 0 * * *"; // 08:00 北京
const CRON_RENEWAL = "0 1 * * *"; // 09:00 北京
const CRON_REMIND = "30 13 * * *"; // 21:30 北京
const CRON_BACKUP = "30 18 * * *"; // 02:30 北京 (次日)

// 续费提醒: 余量低于阈值, 或 30 天内到期
const RENEWAL_WINDOW_DAYS = 30;

const EMPTY_PUSH = { attempted: 0, sent: 0, skipped: 0, failed: 0, truncated: 0 };

async function keepAlive() {
  const admin = getAdmin();
  // 任意轻量读即可刷新项目活跃度
  const { error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (error) throw error;
  return { job: "keepAlive", ok: true };
}

// 空数组时直接返回, 避免生成非法的 `in.()` 查询
async function selectIn(admin, table, columns, column, ids) {
  if (!ids.length) return [];
  const { data, error } = await admin.from(table).select(columns).in(column, ids);
  if (error) throw error;
  return data ?? [];
}

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

// 一次批量取「学员 -> 家长 profile_id 列表」(站内通知的收件人)
async function loadParentProfiles(admin, studentIds) {
  const rows = await selectIn(
    admin,
    "parent_student_links",
    "student_id, parents(profile_id)",
    "student_id",
    studentIds,
  );
  const map = new Map();
  for (const r of rows) {
    const list = map.get(r.student_id) ?? [];
    if (r.parents?.profile_id) list.push(r.parents.profile_id);
    map.set(r.student_id, list);
  }
  return map;
}

// ---------- 上课提醒 ----------

async function lessonReminders() {
  const admin = getAdmin();
  const now = Date.now();
  const soon = new Date(now + 24 * 3600_000).toISOString();
  // ⚠️ 去重键里的「业务日」必须按 Asia/Shanghai，不能用 UTC。
  // 去重键决定「今天这条提醒发过没有」：用UTC 的话，北京时间 08:00 之前
  // （UTC 前一天）算出来的 key 是前一天，于是凌晨那一跑会**再发一遍**当天的提醒。
  // 当前 cron 是 21:30（北京），UTC 恰好还是同一日，所以问题没暴露；
  // 一旦把触发时间提前到早上或推迟到 23:00 之后就立刻变成重复发送。
  // 与本文件backupToR2 的 key 口径保持一致（那里有同样约束的注释）。
  const day = new Date(now + SHANGHAI_OFFSET).toISOString().slice(0, 10);

  const { data: lessons, error } = await admin
    .from("lessons")
    .select(
      "id, scheduled_at, duration_min, teacher_id, student_id, status, meeting_url, students:student_id (full_name, status, wecom_external_user_id), profiles:teacher_id (full_name)",
    )
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", soon)
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  // 仅「在读」学员参与次日课程提醒；停课/休学/结课/退费学员即使仍有已排课节也不推送。
  const dueLessons = (lessons ?? []).filter((l) => l.students?.status === "active");
  const total = dueLessons.length;
  if (!total)
    return { job: "lessonReminders", notified: 0, skipped: 0, total: 0, wecom: EMPTY_PUSH };

  // 一次查出哪些已发过 (逐条查会在 24h 课多时爆 50 子请求上限)
  const keys = dueLessons.map((l) => `lesson-reminder:${l.id}:${day}`);
  const { data: seenRows, error: seenError } = await admin
    .from("reminder_log")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  if (seenError) throw seenError;
  const seen = new Set((seenRows ?? []).map((r) => r.dedupe_key));

  const fresh = dueLessons.filter((l) => !seen.has(`lesson-reminder:${l.id}:${day}`));
  const skipped = total - fresh.length;
  if (!fresh.length) {
    return { job: "lessonReminders", notified: 0, skipped, total, wecom: EMPTY_PUSH };
  }

  const teacherIds = [...new Set(fresh.map((l) => l.teacher_id).filter(Boolean))];
  const studentIds = [...new Set(fresh.map((l) => l.student_id).filter(Boolean))];

  // 老师企微 ID: lessons.teacher_id 是 profile_id, 需反查 teachers
  const teacherRows = await selectIn(
    admin,
    "teachers",
    "profile_id, wecom_user_id",
    "profile_id",
    teacherIds,
  );
  const teacherWecom = new Map(teacherRows.map((t) => [t.profile_id, t.wecom_user_id]));
  const parentsByStudent = await loadParentProfiles(admin, studentIds);

  const notifRows = [];
  const wecomJobs = [];

  for (const l of fresh) {
    const studentName = l.students?.full_name ?? "学员";
    const teacherName = l.profiles?.full_name ?? "老师";
    const when = fmtWhen(l.scheduled_at);
    const body = `${studentName} 将于 ${when} 上 ${teacherName} 的课${
      l.meeting_url ? `, 入会: ${l.meeting_url}` : ""
    }`;

    const parents = parentsByStudent.get(l.student_id) ?? [];
    const targets = [...new Set([...parents, l.teacher_id].filter(Boolean))];
    for (const uid of targets) {
      notifRows.push({
        type: "lesson_reminder",
        title: "上课提醒",
        body,
        target_user: uid,
        student_id: l.student_id,
        link: uid === l.teacher_id ? "/teacher/today" : "/parent",
      });
    }

    wecomJobs.push(
      ...wecom.lessonReminderJobs({
        lesson: {
          studentName,
          teacherName,
          scheduledAt: l.scheduled_at,
          meetingUrl: l.meeting_url,
        },
        teacherWecomId: teacherWecom.get(l.teacher_id),
        // 家长企微 ID 存在学员身上 (见 v4 迁移注释)
        parentWecomIds: [l.students?.wecom_external_user_id],
      }),
    );
  }

  if (notifRows.length) {
    const { error } = await admin.from("notifications").insert(notifRows);
    if (error) throw error;
  }
  const { error: logError } = await admin.from("reminder_log").insert(
    fresh.map((l) => ({
      dedupe_key: `lesson-reminder:${l.id}:${day}`,
      kind: "lesson_reminder",
      channel: "notification+wecom",
      payload: { lesson_id: l.id },
    })),
  );

  if (logError) throw logError;

  const push = wecomJobs.length ? await wecom.runBatch(wecomJobs) : EMPTY_PUSH;
  return { job: "lessonReminders", notified: fresh.length, skipped, total, wecom: push };
}

// ---------- 续费提醒 ----------

// 扫描需要续费提醒的课时包:
//   1) 余量不足: remaining <= max(2, ceil(total * 20%))
//   2) 即将到期: 未过期且 30 天内到期
// 返回 [{ pack, stage, balance, total, key }]
function pickRenewalAlerts(packs, now = Date.now(), settings = INSTITUTION_DEFAULTS) {
  const horizon = now + settings.expiryWarnDays * 86400_000;
  const due = [];
  const latest=new Map();
  for(const p of packs||[]){if(p.student_balance===undefined||Number(p.total_hours)<=0)continue;const prior=latest.get(p.student_id);if(!prior||String(p.purchased_at||p.created_at||p.id)>String(prior.purchased_at||prior.created_at||prior.id))latest.set(p.student_id,p);}
  for (const p of packs ?? []) {
    const total = Number(p.total_hours || 0);
    const balance = Number(p.student_balance ?? p.remaining_hours ?? 0);
    const exp = p.expires_at ? new Date(p.expires_at).getTime() : null;

    const lowThreshold = Math.max(
      settings.renewalMinHours,
      Math.ceil((total * settings.renewalPercent) / 100),
    );
    if (total > 0 && balance <= lowThreshold && (p.student_balance===undefined||latest.get(p.student_id)===p)) {
      due.push({ pack: p, stage: "low", balance, total, key: `renew:${p.id}:low` });
    }
    if (exp !== null && !Number.isNaN(exp) && exp >= now && exp <= horizon) {
      due.push({ pack: p, stage: "expiring", balance, total, key: `renew:${p.id}:expiring` });
    }
  }
  return due;
}

async function renewalReminders() {
  const admin = getAdmin();

  const packs=await require('../lib/renewalBalances.js').loadRenewalPackages(admin);

  const actualPacks=await require('../lib/renewalBalances.js').withStudentBalances(admin,packs);
  const alerts = pickRenewalAlerts(actualPacks, Date.now(), await getSettings());
  if (!alerts.length) {
    return { job: "renewalReminders", notified: 0, skipped: 0, total: 0, wecom: EMPTY_PUSH };
  }

  // 幂等: 同一条 (课时包+阶段) 只发一次。续费会新建一条 student_packages, packId 变化 -> 自然重置
  const { data: seenRows, error: seenError } = await admin
    .from("reminder_log")
    .select("dedupe_key")
    .in(
      "dedupe_key",
      alerts.map((a) => a.key),
    );
  if (seenError) throw seenError;
  const seen = new Set((seenRows ?? []).map((r) => r.dedupe_key));
  const fresh = alerts.filter((a) => !seen.has(a.key));
  const skipped = alerts.length - fresh.length;
  if (!fresh.length) {
    return {
      job: "renewalReminders",
      notified: 0,
      skipped,
      total: alerts.length,
      wecom: EMPTY_PUSH,
    };
  }

  const studentIds = [...new Set(fresh.map((a) => a.pack.student_id).filter(Boolean))];

  // 仅在读学员提醒（停课/休学/结课/退费均不提醒）
  const studentRows = await selectIn(
    admin,
    "students",
    "id, full_name, status, wecom_external_user_id",
    "id",
    studentIds,
  );
  const activeStudents = new Map(
    studentRows.filter((s) => s.status === "active").map((s) => [s.id, s]),
  );
  const parentsByStudent = await loadParentProfiles(admin, [...activeStudents.keys()]);

  const notifRows = [];
  const wecomJobs = [];
  const loggedKeys = [];

  for (const a of fresh) {
    const student = activeStudents.get(a.pack.student_id);
    if (!student) continue; // 学员停课/不存在, 不发也不记幂等键

    const packageName = a.pack.package_types?.name ?? "课时包";
    const expireDay = a.pack.expires_at
      ? new Date(a.pack.expires_at).toISOString().slice(0, 10)
      : "";
    const body =
      a.stage === "low"
        ? `${student.full_name} 的实际剩余课时为 ${a.balance} 小时（最近购买「${packageName}」${a.total} 小时），建议尽快续费。`
        : `${student.full_name} 的课时包「${packageName}」将于 ${expireDay} 到期（学员实际剩余 ${a.balance} 小时），请及时续费。`;

    const parents = parentsByStudent.get(a.pack.student_id) ?? [];
    for (const uid of [...new Set(parents)]) {
      notifRows.push({
        type: "renewal",
        title: a.stage === "low" ? "课时余额不足" : "课时包即将到期",
        body,
        target_user: uid,
        student_id: a.pack.student_id,
        link: "/parent",
      });
    }

    wecomJobs.push(
      ...wecom.renewalJobs({
        alert: {
          packageName,
          balance: a.balance,
          total: a.total,
          expiresAt: a.pack.expires_at,
          stage: a.stage,
        },
        // 家长企微 ID 存在学员身上 (见 v4 迁移注释)
        parentWecomIds: [student.wecom_external_user_id],
      }),
    );
    loggedKeys.push(a);
  }

  if (notifRows.length) {
    const { error } = await admin.from("notifications").insert(notifRows);
    if (error) throw error;
  }
  if (loggedKeys.length) {
    const { error } = await admin.from("reminder_log").insert(
      loggedKeys.map((a) => ({
        dedupe_key: a.key,
        kind: "renewal",
        channel: "notification+wecom",
        payload: {
          student_package_id: a.pack.id,
          stage: a.stage,
          balance: a.balance,
          total: a.total,
        },
      })),
    );
    if (error) throw error;
  }

  const push = wecomJobs.length ? await wecom.runBatch(wecomJobs) : EMPTY_PUSH;
  return {
    job: "renewalReminders",
    notified: loggedKeys.length,
    skipped: skipped + (fresh.length - loggedKeys.length),
    total: alerts.length,
    wecom: push,
  };
}

// ---------- 备份 ----------

// 表清单来自 lib/backup.js —— 备份与恢复必须共用同一份清单,
// 否则会出现「恢复流程以为备份里有 records, 其实从来没有」的静默事故。

async function backupToR2(env) {
  globalThis.__CLOUDFLARE_ENV = env;
  const bucket = env?.BACKUP_BUCKET;
  if (!bucket || typeof bucket.put !== "function") {
    return { job: "backupToR2", skipped: true, reason: "未绑定 R2 (BACKUP_BUCKET)" };
  }
  const admin = getAdmin();
  const archiveApi = require("../lib/backupArchive.js");
  const archive = await archiveApi.create(admin, bucket);
  const failedTables = Object.values(archive.manifest).filter(m => !m.ok).length;
  const envelope = await archiveApi.packArchive(archive);
  const json = JSON.stringify(envelope);
  // 日期必须按 Asia/Shanghai: 定时任务在北京 02:30 触发, 那一刻 UTC 还是前一天 ——
  // 用 UTC 取日期会把key 写成前一天, 于是「昨天到底备份了没」永远对不上号。
  // 全站业务日期都用 +08:00, 这里不能例外。
  const day = new Date(Date.now() + SHANGHAI_OFFSET).toISOString().slice(0, 10);
  const key = `backup/${day}.json`;
  // Immutable history keeps an earlier healthy snapshot when another run fails.
  if (typeof bucket.get === "function") {
    await bucket.put(`backup-history/${day}/${require("node:crypto").randomUUID()}.json`, json, { httpMetadata: { contentType: "application/json" } });
    const previous = await bucket.get(key);
    let old = null;
    if (previous) {
      const parsedOld = JSON.parse(await previous.text());
      old = archiveApi.isEncryptedEnvelope(parsedOld)
        ? (await archiveApi.openArchive(parsedOld)).archive
        : parsedOld;
    }
    if (archive.complete || !old?.complete) await bucket.put(key, json, { httpMetadata: { contentType: "application/json" } });
  } else await bucket.put(key, json, { httpMetadata: { contentType: "application/json" } });
  if (typeof bucket.get === 'function') await bucket.put('backup-status/latest.json', JSON.stringify({ at: archive.finished_at, complete: archive.complete, encrypted: true, key, failedTables: Object.entries(archive.manifest).filter(([,m]) => !m.ok).map(([table,m]) => ({ table, error: m.error })), private: archive.private_manifest, auth: archive.auth_manifest }), { httpMetadata: { contentType: 'application/json' } });
  const admins = await admin.from("profiles").select("id").eq("role", "admin");
  if (!admins.error) {
    const preference = require("../lib/notificationPreferences.js");
    const notices = [];
    for (const person of admins.data || []) {
      if ((await preference.read(person.id)).backups !== true) continue;
      notices.push({
        type: "system",
        target_user: person.id,
        title: !archive.complete ? "每日备份存在异常" : "每日备份完成",
        body: !archive.complete
          ? "部分数据未完整导出，请查看备份清单。"
          : `已导出 ${BACKUP_TABLES.length} 张表和 ${archive.private_objects.length} 个私有对象。`,
        link: "/admin/backups",
      });
    }
    await require("../lib/notify.js").push(notices, { source: "scheduled.backup" });
  }
  return {
    job: "backupToR2",
    key,
    bytes: json.length,
    tables: BACKUP_TABLES.length,
    failed_tables: failedTables,
    complete: archive.complete,
    private_objects: archive.private_manifest.count,
  };
}

// event.cron -> 任务映射; 未知 cron 走 keepAlive (保底)
async function runScheduled(event, env) {
  globalThis.__CLOUDFLARE_ENV = env;
  switch (event?.cron) {
    case "* * * * *":
      return require("../lib/adminBot.js").tickAll();
    case CRON_RENEWAL:
      return renewalReminders();
    case CRON_REMIND:
      return lessonReminders();
    case CRON_BACKUP:
      return backupToR2(env);
    case CRON_KEEPALIVE:
    default:
      return keepAlive();
  }
}

module.exports = {
  CRON_KEEPALIVE,
  CRON_RENEWAL,
  CRON_REMIND,
  CRON_BACKUP,
  RENEWAL_WINDOW_DAYS,
  keepAlive,
  lessonReminders,
  renewalReminders,
  pickRenewalAlerts,
  backupToR2,
  runScheduled,
};
