// 数据备份的「读回」侧 —— 之前只有每天写进 R2 的一半, 没有这一半。
//
// ⚠️ 核心立场: 本接口的**恢复 = 补回备份里有、现在库里没有的行**, 不是「回滚」。
//   把整个库退回备份那一刻, 会连带抹掉备份之后所有人录入的数据 —— 那是更大的事故。
//   所以这里永远只 INSERT 缺失行, 从不 UPDATE / DELETE 现存行。
//
// ⚠️ auth.users 不在备份范围内(Supabase Auth 是独立系统, service_role 也读不到密码哈希)。
//   恢复 profiles 只能救回「账号还在、profile 行被误删」的情况; 连 auth 用户一起删了的话,
//   行补回来也无法登录 —— 必须在 Supabase Auth 控制台重建账号, 并把新 uid 回填到 profiles.id。
//   这条会写进每次恢复的返回体, 免得有人以为点一下就全好了。
//
// 仅管理员: 备份里含家长手机号与老师薪酬。

const { withErrorHandler } = require("../lib/errors.js");
const { ok, badRequest, notFound } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const audit = require("../lib/audit.js");
const backupLib = require("../lib/backup.js");

const {
  TABLES,
  keyForDate,
  bucketFrom,
  listBackups,
  readBackup,
  tableMeta,
  planRestore,
  applyRestore,
  MAX_ROWS_PER_RUN,
} = backupLib;

// 路径形态: /            -> 列出所有备份
//          /latest       -> 最近一份
//          /2026-09-21           -> 该份概览
//          /2026-09-21/diff      -> 与当前库比对
//          /2026-09-21/download  -> 下载原文
function parsePath(pathname) {
  const parts = String(pathname || "/")
    .split("/")
    .filter(Boolean);
  if (parts.length === 0) return { kind: "list" };
  const [head, tail] = parts;
  if (head === "latest") return { kind: "latest" };
  return { kind: "date", date: head, tail: tail || null };
}

async function list_(req, res) {
  const bucket = bucketFrom();
  if (!bucket) {
    return ok(res, { bound: false, items: [], hint: "Worker 未绑定 R2 (BACKUP_BUCKET)" });
  }
  const items = await listBackups(bucket);
  const statusObject = await bucket.get('backup-status/latest.json');
  return ok(res, { bound: true, items, tableCount: TABLES.length, lastAttempt: statusObject ? await statusObject.json() : null });
}

// 读某份备份。返回 null 表示外部已写好响应。
async function load(req, res, key) {
  const bucket = bucketFrom();
  if (!bucket) {
    badRequest(res, "Worker 未绑定 R2 (BACKUP_BUCKET), 无法读取备份");
    return null;
  }
  const got = await readBackup(bucket, key);
  if (!got) {
    notFound(res, "没有这份备份");
    return null;
  }
  if (got.bad) {
    badRequest(res, got.bad);
    return null;
  }
  return got;
}

async function summary(req, res, key) {
  const got = await load(req, res, key);
  if (!got) return;
  const b = got.backup;
  const tables = Object.keys(b.tables ?? {}).map((t) => {
    const m = tableMeta(b, t);
    return {
      table: t,
      rows: Array.isArray(b.tables[t]) ? b.tables[t].length : 0,
      claimed: m?.count ?? null,
      ok: m?.ok ?? false,
      truncated: m?.truncated ?? false,
      verified: m?.verified ?? false,
    };
  });
  // 备份里没录到的表 = 当时就该报警却没人看的漏洞, 概览必须显式列出来。
  const absent = TABLES.filter((t) => !Array.isArray(b.tables?.[t]));
  ok(res, {
    key: got.key,
    size: got.size,
    uploaded: got.uploaded,
    exportedAt: b.exported_at ?? null,
    version: b.version === 3 ? "v3" : b.manifest ? "v2" : "v1(旧格式: 无完整性记录)",
    complete: b.complete === true,
    encrypted: b.encrypted === true,
    private: b.private_manifest || { ok: false, count: 0, error: '旧备份未包含私有数据' },
    auth: b.auth_manifest || { ok: false, count: 0 },
    coverage: b.coverage || null,
    drill: b.version === 3 ? await bucketFrom().get(`backup-validation/${b.sha256}.json`).then(o => o ? o.json() : null) : null,
    tables,
    absent,
    totals: {
      rows: tables.reduce((s, t) => s + t.rows, 0),
      failed: tables.filter((t) => !t.ok).length,
      truncated: tables.filter((t) => t.truncated).length,
    },
  });
}

async function diff(req, res, key) {
  const got = await load(req, res, key);
  if (!got) return;
  const admin = getAdmin();
  const url = new URL(req.url, "http://x");
  const only = url.searchParams.get("table");
  if (only && !TABLES.includes(only)) {
    badRequest(res, `未知表名: ${only}`);
    return;
  }
  const plan = await planRestore(admin, got.backup, only ? [only] : TABLES, {
    maxRows: Number.MAX_SAFE_INTEGER, // diff 只看差额, 不写, 所以不受单次写入预算限制
  });
  ok(res, {
    key: got.key,
    exportedAt: got.backup.exported_at ?? null,
    tables: plan.perTable,
    totalMissing: plan.totalMissing,
  });
}

async function download(req, res, key) {
  const got = await load(req, res, key);
  if (!got) return;
  const date = String(key)
    .replace(/^backup\//, "")
    .replace(/\.json$/, "");
  res.setHeader("content-disposition", `attachment; filename="backup-${date}.json"`);
  res.status(200).json(got.envelope || got.backup);
}

async function restore(req, res, key, date) {
  const got = await load(req, res, key);
  if (!got) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const dryRun = body.dryRun !== false; // 默认只预览 —— 真正写入必须显式声明
  const force = Boolean(body.force);
  const tables = Array.isArray(body.tables) && body.tables.length ? body.tables : TABLES;
  const unknown = tables.filter((t) => !TABLES.includes(t));
  if (unknown.length) {
    badRequest(res, `未知表名: ${unknown.join(", ")}`);
    return;
  }
  const maxRows = Math.min(
    Number.isFinite(Number(body.maxRows)) && Number(body.maxRows) > 0
      ? Number(body.maxRows)
      : MAX_ROWS_PER_RUN,
    MAX_ROWS_PER_RUN,
  );

  const admin = getAdmin();
  const plan = await planRestore(admin, got.backup, tables, { maxRows, force });

  if (dryRun) {
    // 预览: 跟真跑完全一致的决策, 只是不写库。让人先看清楚要补回哪些。
    return ok(res, {
      dryRun: true,
      key: got.key,
      maxRows,
      tables: plan.perTable,
      totalMissing: plan.totalMissing,
      totalPlanned: plan.totalPlanned,
      note: "这是预览, 没有写任何数据。要真恢复请把 dryRun 置为 false。",
    });
  }

  await require('../lib/adminConfirmation.js').verify(req, body.current_password);
  const results = await applyRestore(admin, plan);
  const inserted = results.reduce((s, r) => s + r.inserted, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0);

  await audit.record(
    req.context?.userId ?? null,
    "backup.restore",
    "backup",
    key,
    { date, tables, inserted, failed, force, maxRows },
    req.reqId,
  );

  ok(res, {
    dryRun: false,
    key: got.key,
    inserted,
    failed,
    results,
    remaining: Math.max(0, plan.totalMissing - inserted),
    blocked: plan.perTable.filter(t => t.blocked),
    caveat:
      "auth.users 的密码和登录会话不在备份内；账号元数据供单独恢复登录账号、核对用户关联使用，本页不会自动迁移账号身份。",
  });
}

module.exports = withErrorHandler(async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = parsePath(url.pathname);
  const label =
    p.kind === "list" ? "列出备份" : p.kind === "latest" ? "查看最新备份" : `恢复/查看 ${p.date}`;
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  return require('../lib/dataScope.js').runSystem('all', async () => {

  if (url.pathname === '/create' && req.method === 'POST') {
    const result = await require('../lib/dataScope.js').runSystem('all', () => require('../src/scheduled.js').backupToR2(globalThis.__CLOUDFLARE_ENV));
    return ok(res, result);
  }

  if (p.kind === "list") return list_(req, res);

  if (p.kind === "latest") {
    const bucket = bucketFrom();
    if (!bucket) return badRequest(res, "Worker 未绑定 R2 (BACKUP_BUCKET)");
    const items = await listBackups(bucket);
    if (!items.length) return notFound(res, "还没有任何备份");
    const key = items[0].key;
    if (req.method === "POST") return restore(req, res, key, items[0].date);
    return summary(req, res, key);
  }

  const key = keyForDate(p.date);
  if (!key) {
    badRequest(res, "日期格式应为 YYYY-MM-DD");
    return;
  }
  if (!p.tail) {
    if (req.method === "POST") return restore(req, res, key, p.date);
    return summary(req, res, key);
  }
  if (p.tail === "restore") {
    if (req.method !== "POST") {
      badRequest(res, "恢复必须用 POST");
      return;
    }
    return restore(req, res, key, p.date);
  }
  if (p.tail === "diff") return diff(req, res, key);
  if (p.tail === 'verify' && req.method === 'POST') {
    const got = await load(req, res, key);
    if (!got) return;
    const result = await require('../lib/backupArchive.js').drill(bucketFrom(), got.backup);
    const report = { ...result, at: new Date().toISOString(), key };
    await bucketFrom().put(`backup-validation/${got.backup.sha256}.json`, JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } });
    return ok(res, report);
  }
  if (p.tail === 'private-restore' && req.method === 'POST') {
    const got = await load(req, res, key);
    if (!got) return;
    const dryRun = req.body?.dryRun !== false;
    if (!dryRun) await require('../lib/adminConfirmation.js').verify(req, req.body?.current_password);
    const result = await require('../lib/backupArchive.js').restorePrivate(bucketFrom(), got.backup, dryRun);
    if (!dryRun) await audit.record(req.context.userId, 'backup.private-restore', 'backup', key, result, req.reqId);
    return ok(res, result);
  }
  if (p.tail === "download") return download(req, res, key);
  notFound(res, `未知路径: ${label}/${p.tail}`);
  });
});
