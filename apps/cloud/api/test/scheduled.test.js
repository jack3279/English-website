const test = require("node:test");
const assert = require("node:assert/strict");
const { setMockResult, setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

const {
  CRON_REMIND,
  CRON_BACKUP,
  CRON_KEEPALIVE,
  CRON_RENEWAL,
  keepAlive,
  lessonReminders,
  renewalReminders,
  pickRenewalAlerts,
  backupToR2,
  runScheduled,
} = require("../src/scheduled.js");
const archiveApi = require("../lib/backupArchive.js");

async function readStoredArchive(value) {
  const envelope = JSON.parse(value);
  return archiveApi.isEncryptedEnvelope(envelope)
    ? (await archiveApi.openArchive(envelope)).archive
    : envelope;
}

const DAY = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const LESSON = {
  id: "l1",
  scheduled_at: new Date(Date.now() + 10 * 3600_000).toISOString(),
  duration_min: 60,
  teacher_id: "t1",
  student_id: "s1",
  status: "scheduled",
  meeting_url: "https://meeting/1",
  students: { full_name: "小明", status: "active" },
  profiles: { full_name: "Alice" },
};

const TEACHER_ROW = { profile_id: "t1", wecom_user_id: null };
const LINK_ROW = { student_id: "s1", parents: { profile_id: "p1", wecom_external_user_id: null } };

// 已绑定企微的场景: 家长企微 ID 存在学员身上 (见 v4 迁移注释)
const LESSON_BOUND = {
  ...LESSON,
  students: { full_name: "小明", status: "active", wecom_external_user_id: "wx_parent" },
};
const TEACHER_BOUND = { profile_id: "t1", wecom_user_id: "wx_teacher" };

test("keepAlive 执行一次轻量查询", async () => {
  resetMock();
  setMockResult({ data: [{ id: "x" }], error: null });
  const r = await keepAlive();
  assert.equal(r.ok, true);
});

test("lessonReminders 给家长+老师发提醒并写幂等日志", async () => {
  resetMock();
  setMockResults([
    { data: [LESSON], error: null }, // lessons
    { data: [], error: null }, // reminder_log 未发过
    { data: [TEACHER_ROW], error: null }, // teachers (企微 ID)
    { data: [LINK_ROW], error: null }, // parent_student_links
    { data: null, error: null }, // notifications insert
    { data: null, error: null }, // reminder_log insert
  ]);
  const r = await lessonReminders();
  assert.equal(r.notified, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.total, 1);
});

test("lessonReminders 已发过则跳过 (幂等)", async () => {
  resetMock();
  setMockResults([
    { data: [LESSON], error: null },
    { data: [{ dedupe_key: `lesson-reminder:l1:${DAY}` }], error: null },
  ]);
  const r = await lessonReminders();
  assert.equal(r.notified, 0);
  assert.equal(r.skipped, 1);
});

test("lessonReminders 无课节时直接返回", async () => {
  resetMock();
  setMockResults([{ data: [], error: null }]);
  const r = await lessonReminders();
  assert.equal(r.notified, 0);
  assert.equal(r.total, 0);
});

test("lessonReminders 非在读学员（休学/停课等）不发次日提醒", async () => {
  resetMock();
  const inactiveLesson = {
    ...LESSON,
    id: "l2",
    students: { full_name: "小明", status: "leave" },
  };
  setMockResults([{ data: [inactiveLesson], error: null }]);
  const r = await lessonReminders();
  assert.equal(r.total, 0, "休学学员的课节不计入待提醒");
  assert.equal(r.notified, 0);
});

test("上课提醒去重查询失败时停止发送", async () => {
  resetMock();
  setMockResults([
    { data: [LESSON], error: null },
    { data: null, error: new Error("dedupe unavailable") },
  ]);
  await assert.rejects(() => lessonReminders(), /dedupe unavailable/);
});

test("北京时间凌晨重复执行按北京时间业务日去重", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-10-07T18:30:00Z");
  try {
    resetMock();
    setMockResults([
      { data: [LESSON], error: null },
      { data: [{ dedupe_key: "lesson-reminder:l1:2026-10-08" }], error: null },
    ]);
    const result = await lessonReminders();
    assert.equal(result.notified, 0);
    assert.equal(result.skipped, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("续费提醒去重查询失败时停止发送", async () => {
  resetMock();
  setMockResults([
    { data: [{ id: "sp1", student_id: "s1", total_hours: 20, remaining_hours: 2 }], error: null },
    {data:[{student_id:"s1",remaining_hours:2}],error:null},
    { data: null, error: new Error("dedupe unavailable") },
  ]);
  await assert.rejects(() => renewalReminders(), /dedupe unavailable/);
});

test("上课通知写入失败时不能记为已提醒", async () => {
  resetMock();
  setMockResults([
    { data: [LESSON], error: null },
    { data: [], error: null },
    { data: [TEACHER_ROW], error: null },
    { data: [LINK_ROW], error: null },
    { data: null, error: new Error("notification write failed") },
  ]);
  await assert.rejects(() => lessonReminders(), /notification write failed/);
});

test("保活查询失败时不能报告成功", async () => {
  resetMock();
  setMockResult({ data: null, error: new Error("database unavailable") });
  await assert.rejects(() => keepAlive(), /database unavailable/);
});

test("lessonReminders 已绑定企微但未配置凭证时, 企微跳过、站内通知照发", async () => {
  delete globalThis.__CLOUDFLARE_ENV;
  resetMock();
  setMockResults([
    { data: [LESSON_BOUND], error: null },
    { data: [], error: null },
    { data: [TEACHER_BOUND], error: null },
    { data: [LINK_ROW], error: null },
    { data: null, error: null }, // notifications insert
    { data: null, error: null }, // reminder_log insert
  ]);
  const r = await lessonReminders();
  assert.equal(r.notified, 1, "站内通知不受影响");
  assert.equal(r.wecom.sent, 0);
  assert.equal(r.wecom.skipped, 2, "老师 1 + 家长 1 都应被跳过(未配凭证)");
});

test("配置企微凭证后上课提醒真的推到老师与家长", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    WECHAT_CORP_ID: "ww_sched",
    WECHAT_CORP_SECRET: "app_sched",
    WECHAT_AGENT_ID: "1000002",
    WECHAT_EXTCONTACT_SECRET: "ext_sched",
  };
  resetMock();
  setMockResults([
    { data: [LESSON_BOUND], error: null },
    { data: [], error: null },
    { data: [TEACHER_BOUND], error: null },
    { data: [LINK_ROW], error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    const payload = u.includes("gettoken")
      ? { errcode: 0, access_token: "TK", expires_in: 7200 }
      : { errcode: 0 };
    return { status: 200, text: async () => JSON.stringify(payload) };
  };
  try {
    const r = await lessonReminders();
    assert.equal(r.wecom.sent, 2, "老师应用消息 + 家长客户联系各 1 条");
    const appSend = calls.find((c) => c.url.includes("/cgi-bin/message/send"));
    const extSend = calls.find((c) => c.url.includes("externalcontact/message/send"));
    assert.equal(appSend.body.touser, "wx_teacher");
    assert.equal(extSend.body.to_external_userid[0], "wx_parent");
    assert.match(extSend.body.text.content, /上课提醒/);
    assert.match(extSend.body.text.content, /https:\/\/meeting\/1/, "应带上入会链接");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------- 续费提醒 ----------

test("pickRenewalAlerts 按余量阈值与到期窗口判定", () => {
  const now = Date.now();
  const packs = [
    { id: "p-low", student_id: "s1", total_hours: 20, remaining_hours: 3, expires_at: null }, // 3 <= max(2,4)
    { id: "p-enough", student_id: "s1", total_hours: 20, remaining_hours: 15, expires_at: null },
    { id: "p-tiny", student_id: "s1", total_hours: 10, remaining_hours: 2, expires_at: null }, // 2 <= max(2,2)
    {
      id: "p-expiring",
      student_id: "s1",
      total_hours: 20,
      remaining_hours: 15,
      expires_at: new Date(now + 10 * 86400_000).toISOString(),
    },
    {
      id: "p-far",
      student_id: "s1",
      total_hours: 20,
      remaining_hours: 15,
      expires_at: new Date(now + 90 * 86400_000).toISOString(),
    },
  ];
  const due = pickRenewalAlerts(packs, now);
  const keys = due.map((d) => d.key).sort();
  assert.deepEqual(
    keys,
    ["renew:p-expiring:expiring", "renew:p-low:low", "renew:p-tiny:low"].sort(),
  );
  assert.equal(due.find((d) => d.key === "renew:p-low:low").balance, 3);
  assert.equal(due.find((d) => d.key === "renew:p-expiring:expiring").stage, "expiring");
});

test("renewalReminders 提醒家长并写幂等日志", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        {
          id: "sp1",
          student_id: "s1",
          total_hours: 20,
          remaining_hours: 2,
          expires_at: null,
          package_types: { name: "20课时" },
        },
      ],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2}],error:null}, // authoritative balance
    { data: [], error: null }, // reminder_log 未发过
    { data: [{ id: "s1", full_name: "小明", status: "active" }], error: null }, // students
    { data: [LINK_ROW], error: null }, // parents
    { data: null, error: null }, // notifications insert
    { data: null, error: null }, // reminder_log insert
  ]);
  const r = await renewalReminders();
  assert.equal(r.notified, 1);
  assert.equal(r.total, 1);
});

test("renewalReminders 已提醒过则跳过", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        {
          id: "sp1",
          student_id: "s1",
          total_hours: 20,
          remaining_hours: 2,
          expires_at: null,
          package_types: { name: "20课时" },
        },
      ],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2}],error:null}, // authoritative balance
    { data: [{ dedupe_key: "renew:sp1:low" }], error: null },
  ]);
  const r = await renewalReminders();
  assert.equal(r.notified, 0);
  assert.equal(r.skipped, 1);
});

test("renewalReminders 停课学员不提醒", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        {
          id: "sp1",
          student_id: "s1",
          total_hours: 20,
          remaining_hours: 2,
          expires_at: null,
          package_types: { name: "20课时" },
        },
      ],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2}],error:null}, // authoritative balance
    { data: [], error: null },
    { data: [{ id: "s1", full_name: "小明", status: "inactive" }], error: null },
  ]);
  const r = await renewalReminders();
  assert.equal(r.notified, 0);
});

test("renewalReminders 无课时包时返回零", async () => {
  resetMock();
  setMockResults([{ data: [], error: null }]);
  const r = await renewalReminders();
  assert.equal(r.notified, 0);
  assert.equal(r.total, 0);
});

test("renewalReminders 配置凭证后推到家长企微 (低余额文案)", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    WECHAT_CORP_ID: "ww_renew",
    WECHAT_CORP_SECRET: "app_renew",
    WECHAT_AGENT_ID: "1000002",
    WECHAT_EXTCONTACT_SECRET: "ext_renew",
  };
  resetMock();
  setMockResults([
    {
      data: [
        {
          id: "sp1",
          student_id: "s1",
          total_hours: 20,
          remaining_hours: 2,
          expires_at: null,
          package_types: { name: "20课时" },
        },
      ],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2}],error:null}, // authoritative balance
    { data: [], error: null },
    {
      data: [{ id: "s1", full_name: "小明", status: "active", wecom_external_user_id: "wx_p1" }],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2}],error:null}, // authoritative balance
    { data: [LINK_ROW], error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    const payload = u.includes("gettoken")
      ? { errcode: 0, access_token: "TK", expires_in: 7200 }
      : { errcode: 0 };
    return { status: 200, text: async () => JSON.stringify(payload) };
  };
  try {
    const r = await renewalReminders();
    assert.equal(r.wecom.sent, 1, "家长应收到 1 条续费提醒");
    const send = calls.find((c) => c.url.includes("externalcontact/message/send"));
    assert.equal(send.body.to_external_userid[0], "wx_p1");
    assert.match(send.body.text.content, /剩余 2 小时/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------- 备份与分发 ----------

test("backupToR2 导出全部核心表到 R2", async () => {
  resetMock();
  setMockResult({ data: [{ id: "row" }], error: null });
  const puts = [];
  const bucket = {
    async get() {
      return null;
    },
    put: async (key, body, opts) => {
      const parsed = JSON.parse(body);
      puts.push({
        key,
        envelope: archiveApi.isEncryptedEnvelope(parsed) ? parsed : null,
        body: archiveApi.isEncryptedEnvelope(parsed) ? await readStoredArchive(body) : parsed,
        opts,
      });
    },
  };
  const r = await backupToR2({
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BACKUP_BUCKET: bucket,
  });
  assert.equal(r.skipped, undefined);
  assert.equal(puts.length, 3);
  assert.match(puts[1].key, /^backup\/\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(puts[1].envelope.format, "encrypted-backup");
  assert.equal(JSON.stringify(puts[1].envelope).includes("row"), false);
  assert.ok(puts[1].body.encrypted);
  assert.ok(puts[1].body.tables.lessons.length === 1);
  assert.ok(Object.keys(puts[1].body.tables).length >= 15);
});

test("backupToR2 未绑定 R2 时优雅跳过", async () => {
  resetMock();
  const r = await backupToR2({});
  assert.equal(r.skipped, true);
});

test("runScheduled 按 cron 表达式分发", async () => {
  resetMock();
  setMockResult({ data: [{ id: "x" }], error: null });
  assert.equal((await runScheduled({ cron: CRON_KEEPALIVE }, {})).job, "keepAlive");
  resetMock();
  setMockResults([{ data: [], error: null }]);
  assert.equal((await runScheduled({ cron: CRON_REMIND }, {})).job, "lessonReminders");
  resetMock();
  setMockResults([{ data: [], error: null }]);
  assert.equal((await runScheduled({ cron: CRON_RENEWAL }, {})).job, "renewalReminders");
  resetMock();
  assert.equal((await runScheduled({ cron: CRON_BACKUP }, {})).skipped, true);
});
