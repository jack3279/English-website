// R2 备份的**唯一读写约定**。
//
// 备份生成(src/scheduled.js)与恢复(routes/backups.js)必须共用这里的表清单与身份列,
// 否则必然出现「备份里其实没有 records, 但恢复流程以为有」这种经典事故 ——
// 而且它是静默的: 页面会说「全部恢复完成」, 数据却还是残的。

const PREFIX = "backup/";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 一次 select 最多取多少行。超了就标记 truncated, 让下游知道这份备份不完整。
const EXPORT_LIMIT = 20000;

// 单表最多抓多少行做「差异比对」。超过就放弃该表的安全判定, 直接标 blocked。
const KEYSET_CAP = 50000;

// 「差异比对」总共允许发多少个子请求 —— **整个 restore 计划共享一个预算**。
//
// ⚠️ 之前是「每张表各自最多 50000 行 / 每页 1000」= 单表最多 50 个请求，
// 而 Workers 免费档**单个请求总共只允许 50 个子请求**。TABLES 有 20+ 张，
// 只要有 2 张大表就必然超限 → 计划阶段直接抛错，整个恢复流程走不通。
//
// 现在改成全局预算：优先给前面的表（按外键顺序，前面的表小、收益高），
// 预算用完就如实标 blocked，绝不静默少比对 —— 「不知道」和「以为比对过了」差很远。
const DIFF_REQUEST_BUDGET = 32;

// 预算耗尽 / 触顶时，标记 blocked 的统一说明，便于前端/日志定位原因。
const BUDGET_REASON = "restore_diff_subrequest_budget_exhausted";

// 单次请求最多写回多少行 —— Workers 免费档 CPU 极贵, 大批量要分批跑。
const MAX_ROWS_PER_RUN = 500;

// 单条 POST 插入的行数。50 是权衡: 太大, 一行数据有问题会拖垮整批;
// 太小, Workers 的子请求预算会先耗尽。
const INSERT_CHUNK = 50;

// 覆盖**全部**业务表。
// 之前只备份了 18 张, 漏了 branches / records / parent_feeds / internal_messages /
// leads / notification_reads。其中 records 是课后反馈正文、parent_feeds 是家长
// 看到的发布记录 —— 漏掉它们等于「能恢复, 但恢复出来是残的」。
const TABLES = [
  "branches",
  "profiles",
  "students",
  "teachers",
  "parents",
  "parent_student_links",
  "package_types",
  "student_packages",
  "package_payments",
  "courses",
  "lessons",
  "records",
  "parent_feeds",
  "lesson_transactions",
  "leave_requests",
  "makeups",
  "notifications",
  "notification_reads",
  "announcements",
  "materials",
  "internal_messages",
  "leads",
  "reminder_log",
  "audit_log",
];

// 没有单列 id 主键的表 —— 身份由多列共同决定, 按 id 去重会漏行。
const IDENTITY = {
  parent_student_links: ["parent_id", "student_id"],
  notification_reads: ["user_id", "notification_id"],
};

// 插入顺序 = 外键依赖顺序。父行必须先落地, 否则子行会撞 FK 约束:
// 典型的如 records -> lessons -> courses -> students -> branches。
const RESTORE_ORDER = [
  "branches",
  "profiles",
  "students",
  "teachers",
  "parents",
  "parent_student_links",
  "package_types",
  "student_packages",
  "package_payments",
  "courses",
  "lessons",
  "records",
  "parent_feeds",
  "lesson_transactions",
  "leave_requests",
  "makeups",
  "notifications",
  "notification_reads",
  "announcements",
  "materials",
  "internal_messages",
  "leads",
  "reminder_log",
  "audit_log",
];

function identityOf(table) {
  return IDENTITY[table] ?? ["id"];
}

function keyOf(row, cols = ["id"]) {
  return cols.map((c) => String(row?.[c] ?? "")).join("␟");
}

// 按外键依赖排序; 未登记的表一律排最后(宁可顺序保守, 也不要猜错导致 FK 失败)。
function orderedTables(tables) {
  const input = [...new Set(tables)];
  return input.sort(
    (a, b) => (RESTORE_ORDER.indexOf(a) + 1 || 999) - (RESTORE_ORDER.indexOf(b) + 1 || 999),
  );
}

function allowedTable(t) {
  return TABLES.includes(t);
}

// ── R2 访问 ──────────────────────────────────────────────────

// date 必须严格是 YYYY-MM-DD: 它会被拼进 R2 key, 绝不能让 "..%2F" 之类进来。
function keyForDate(date) {
  if (!DATE_RE.test(String(date || ""))) return null;
  return `${PREFIX}${date}.json`;
}

function dateFromKey(key) {
  const m = String(key || "").match(/^backup\/(\d{4}-\d{2}-\d{2})\.json$/);
  return m ? m[1] : null;
}

function bucketFrom(env = globalThis.__CLOUDFLARE_ENV) {
  const b = env?.BACKUP_BUCKET;
  return b && typeof b.list === "function" && typeof b.get === "function" ? b : null;
}

async function listBackups(bucket) {
  const items = [];
  let cursor;
  // R2 每次最多返 1000 个。真有上千份备份时(一年才 365 份)基本一轮就够,
  // 但循环是为将来按小时备份留的。
  for (let i = 0; i < 20; i += 1) {
    const page = await bucket.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) });
    for (const o of page?.objects ?? []) {
      const date = dateFromKey(o.key);
      if (!date) continue;
      items.push({
        date,
        key: o.key,
        size: o.size ?? null,
        uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : (o.uploaded ?? null),
      });
    }
    if (!page?.truncated || !page?.cursor) break;
    cursor = page.cursor;
  }
  // 新的在前: 恢复时最常用的是最近一份。
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items;
}

async function readBackup(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const text = await obj.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { key, bad: `备份文件不是合法 JSON: ${e.message}` };
  }
  const archiveApi = require('./backupArchive.js');
  const opened = await archiveApi.openArchive(parsed);
  if (!opened.archive || typeof opened.archive.tables !== "object" || opened.archive.tables === null) {
    return { key, bad: "备份文件结构不对(缺少 tables)" };
  }
  await archiveApi.validate(opened.archive);
  return {
    key,
    size: obj.size ?? null,
    uploaded: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : (obj.uploaded ?? null),
    backup: opened.archive,
    encrypted: opened.encrypted,
    envelope: opened.encrypted ? parsed : null,
  };
}

// ── 清单/manifest ────────────────────────────────────────────
// v2 备份带 manifest: 每张表单独记了 count / ok / truncated。
// v1(2026-09-21 之前)只有 tables, 只能"看起来有几行就是几行" ——
// 那时 select 失败会静默写成空数组, limit 截断也没人知道。
function tableMeta(backup, table) {
  const m = backup?.manifest?.[table];
  if (m && typeof m === "object") {
    return {
      count: Number.isFinite(Number(m.count)) ? Number(m.count) : null,
      ok: m.ok !== false,
      truncated: Boolean(m.truncated),
      verified: true,
    };
  }
  const rows = backup?.tables?.[table];
  if (Array.isArray(rows)) {
    // v1: 行数可信, 但"这份是不是完整"不可信 —— 只能当尽力而为。
    return { count: rows.length, ok: true, truncated: false, verified: false };
  }
  return null;
}

function backupRows(backup, table) {
  const rows = backup?.tables?.[table];
  return Array.isArray(rows) ? rows : [];
}

// ── 差异比对 ─────────────────────────────────────────────────

// 把库里现有的身份列拉成一个 Set。只 select 身份列, 不拉整表:
// 出网按月 5GB 计费, 拉整表纯属浪费。
//
// budget: 共享的子请求预算对象 { left: number }，整个 restore 计划共用一个。
// 预算耗尽时返回 truncated:true **且** exhausted:true，让调用方能区分
// 「这张表本来就小于上限」和「没预算了、根本没比完」。
async function existingKeySet(admin, table, budget) {
  const cols = identityOf(table).join(", ");
  const set = new Set();
  let from = 0;
  const page = 1000;
  for (;;) {
    if (budget && budget.left <= 0) {
      // 预算用尽：如实返回已抓到的部分 + 明确标记，绝不假装比对完了
      return { set, truncated: true, exhausted: true };
    }
    if (budget) budget.left -= 1;
    const { data, error } = await admin
      .from(table)
      .select(cols)
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) set.add(keyOf(r, identityOf(table)));
    if (rows.length < page) break;
    from += page;
    // 单表硬上限：表本身就有 5 万行以上时也不允许无限翻页
    if (from >= KEYSET_CAP) return { set, truncated: true, exhausted: false };
  }
  return { set, truncated: false, exhausted: false };
}

// 「备份里有、库里没有」的行 = 被删掉的行, 这是我们要补回来的。
// 反过来「库里有、备份里没有」是正常的 —— 备份之后新产生的行。
async function planRestore(
  admin,
  backup,
  tables,
  { maxRows = MAX_ROWS_PER_RUN, force = false } = {},
) {
  const perTable = [];
  let budget = maxRows;
  let totalMissing = 0;
  let totalPlanned = 0;
  // 全局子请求预算：Workers 免费档单请求上限 50，这里留 10 条余量给其它调用
  const reqBudget = { left: DIFF_REQUEST_BUDGET };

  for (const table of orderedTables(tables)) {
    if (!allowedTable(table)) {
      perTable.push({
        table,
        backupRows: 0,
        dbRows: 0,
        missing: 0,
        planned: 0,
        blocked: true,
        reason: "不在备份表清单内",
      });
      continue;
    }
    const meta = tableMeta(backup, table);
    const rows = backupRows(backup, table);
    if (!meta) {
      perTable.push({
        table,
        backupRows: 0,
        dbRows: 0,
        missing: 0,
        planned: 0,
        blocked: true,
        reason: "这份备份里没有该表",
      });
      continue;
    }

    let existing;
    let keysetTruncated = false;
    try {
      const r = await existingKeySet(admin, table, reqBudget);
      existing = r.set;
      keysetTruncated = r.truncated;
      // 预算耗尽：这张表**没比完**，partial 的 Set 会把「没抓到的行」误判成「库里没有」，
      // 进而生成一堆本不该执行的 INSERT。所以必须 blocked，绝不能继续算missing。
      if (r.exhausted) {
        perTable.push({
          table,
          backupRows: rows.length,
          dbRows: null,
          missing: 0,
          planned: 0,
          blocked: true,
          reason: BUDGET_REASON,
        });
        continue;
      }
    } catch (e) {
      perTable.push({
        table,
        backupRows: rows.length,
        dbRows: null,
        missing: 0,
        planned: 0,
        blocked: true,
        reason: `读取当前库失败: ${e.message}`,
      });
      continue;
    }

    const cols = identityOf(table);
    const missing = rows.filter((r) => !existing.has(keyOf(r, cols)));
    // 行本身缺主键就别写了 —— 插进去只会炸, 而且炸的是整批。
    const restorable = missing.filter((r) =>
      cols.every((c) => r?.[c] !== undefined && r?.[c] !== null),
    );
    const skipped = missing.length - restorable.length;

    const item = {
      table,
      backupRows: rows.length,
      dbRows: existing.size,
      missing: missing.length,
      planned: 0,
      blocked: false,
      verified: meta.verified,
      truncated: meta.truncated,
      incomplete: meta.ok === false || meta.truncated,
    };

    if (!meta.ok || meta.truncated) {
      item.blocked = true;
      item.reason = "这份备份该表未完整导出，拒绝恢复";
      perTable.push(item);
      continue;
    }
    if (keysetTruncated) {
      item.blocked = true;
      item.reason = `该表现有行数超过 ${KEYSET_CAP}, 无法安全判定缺失。请按学员/时间手工处理`;
      perTable.push(item);
      continue;
    }
    if (skipped > 0) item.skipped = skipped;

    const take = Math.max(0, Math.min(restorable.length, budget));
    item.planned = take;
    item.rows = restorable.slice(0, take);
    budget -= take;
    if (take < restorable.length)
      item.note = `本次预算只够恢复 ${take} 行, 剩余 ${restorable.length - take} 行请再跑一次`;

    totalMissing += missing.length;
    totalPlanned += take;
    perTable.push(item);
    if (budget <= 0) break;
  }

  return {
    perTable: perTable.map(({ rows, ...rest }) => rest),
    rows: perTable
      .filter((i) => !i.blocked && i.planned > 0)
      .map(({ table, rows }) => ({ table, rows: rows ?? [] })),
    totalMissing,
    totalPlanned,
    maxRows,
  };
}

// ── 写入 ─────────────────────────────────────────────────────
// 只补缺失行, 绝不 UPDATE 现存行 —— 这是本恢复流程的核心立场:
// 「把数据库回滚到备份那一刻」会连带抹掉备份之后所有人做的工作, 代价远大于收益。
async function applyRestore(admin, plan) {
  const results = [];
  for (const group of plan.rows) {
    const { table, rows } = group;
    let inserted = 0;
    const failures = [];
    let failed = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      try {
        const out = await restInsert(table, chunk);
        inserted += Array.isArray(out) ? out.length : chunk.length;
      } catch (e) {
        // 整批失败通常只是一两行脏数据(比如 records.lesson_id 撞唯一约束)。
        // 逐行重试把能救的救回来, 而不是整批放弃。
        for (const row of chunk) {
          try {
            await restInsert(table, [row]);
            inserted += 1;
          } catch (e2) {
            failed += 1;
            if (failures.length < 20) {
              failures.push({
                id: String(row?.id ?? ""),
                error: String(e2?.message || e2).slice(0, 200),
              });
            }
          }
        }
      }
    }
    results.push({ table, inserted, failed, failures });
  }
  return results;
}

// 延迟 require: lib/rest.js 在部分单测环境里会被替换, 运行时取最新实现更稳。
let _rest;
function restInsert(table, rows) {
  if (!_rest) _rest = require("./rest.js");
  return _rest.restInsert(table, rows);
}

module.exports = {
  PREFIX,
  DATE_RE,
  TABLES,
  EXPORT_LIMIT,
  MAX_ROWS_PER_RUN,
  keyOf,
  keyForDate,
  dateFromKey,
  bucketFrom,
  identityOf,
  orderedTables,
  allowedTable,
  listBackups,
  readBackup,
  tableMeta,
  backupRows,
  existingKeySet,
  planRestore,
  applyRestore,
};
