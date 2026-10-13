const { AsyncLocalStorage } = require("node:async_hooks");
const { HttpError } = require("./errors.js");
const storage = new AsyncLocalStorage();
const TABLES = new Set([
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
  "auth_sessions",
  "course_types",
  "student_balance",
  "teacher_payroll",
]);
const FOREIGN = {
  student_id: "students",
  teacher_id: "profiles",
  profile_id: "profiles",
  parent_id: "parents",
  course_id: "courses",
  student_package_id: "student_packages",
  package_type_id: "package_types",
  record_id: "records",
  lesson_id: "lessons",
  original_lesson_id: "lessons",
  makeup_lesson_id: "lessons",
  leave_request_id: "leave_requests",
  to_user: "profiles",
  target_user: "profiles",
};
const PATHS = {
  students: "students",
  teachers: "teachers",
  "teacher-availability": "profiles",
  courses: "courses",
  schedules: "lessons",
  lessons: "lessons",
  leave: "leave_requests",
  makeups: "makeups",
  leads: "leads",
  reports: "records",
  families: "parents",
  accounts: "profiles",
  announcements: "announcements",
  materials: "materials",
  sessions: "auth_sessions",
};
function current() {
  return storage.getStore() || null;
}
function base() {
  const db = require("./supabase.js");
  return (db.getUnscopedAdmin || db.getAdmin)();
}
function flag() {
  const s = current();
  return s?.mode === "test" ? true : s?.mode === "production" ? false : null;
}
function apply(query, table) {
  const f = flag();
  return f !== null && TABLES.has(table)
    ? query.eq("is_test", table === "auth_sessions" ? !!current().isTestAccount : f)
    : query;
}
async function target(table, id) {
  if (!id || !TABLES.has(table) || flag() === null) return;
  const ctx = current();
  ctx.targets ||= new Set();
  const cacheKey = table + ":" + id;
  if (ctx.targets.has(cacheKey)) return;
  const r = await base().from(table).select("id,is_test").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) throw new HttpError(404, "NOT_FOUND", "记录不存在");
  if (!!r.data.is_test !== flag())
    throw new HttpError(403, "DATA_SCOPE_FORBIDDEN", "不能跨正式与测试数据范围操作");
  ctx.targets.add(cacheKey);
}
async function guardExisting(table, rows) {
  if (!current() || flag() === null || !TABLES.has(table)) return;
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (!row?.id) continue;
    const r = await base().from(table).select("id,is_test").eq("id", row.id).maybeSingle();
    if (r.error) throw r.error;
    if (r.data && !!r.data.is_test !== flag())
      throw new HttpError(403, "DATA_SCOPE_FORBIDDEN", "不能覆盖其他数据范围的记录");
  }
}
async function guardRows(table, rows) {
  if (!current() || flag() === null) return;
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    for (const [key, related] of Object.entries(FOREIGN))
      if (row?.[key]) await target(related, row[key]);
    if (row?.branch_id) await target("branches", row.branch_id);
  }
}
function prepareRows(table, rows, insert = true) {
  const f = flag();
  if (f === null || !TABLES.has(table)) return rows;
  const prepare = (row) => {
    const r = { ...row, is_test: f };
    if (insert && f && ["students", "profiles", "courses"].includes(table) && !r.branch_id)
      r.branch_id = current().testBranchId;
    return r;
  };
  return Array.isArray(rows) ? rows.map(prepare) : prepare(rows);
}
function wrapQuery(query, table, write = null) {
  return new Proxy(query, {
    get(q, key) {
      if (key === "then")
        return (resolve, reject) =>
          Promise.resolve()
            .then(async () => {
              if (write) {
                await guardRows(table, write.rows);
                if (write.upsert) await guardExisting(table, write.rows);
              }
              return await apply(q, table);
            })
            .then(resolve, reject);
      const v = q[key];
      if (typeof v !== "function") return v;
      return (...args) => {
        let nextWrite = write;
        if (["insert", "upsert", "update"].includes(key)) {
          args[0] = prepareRows(table, args[0], key !== "update");
          nextWrite = { rows: args[0], upsert: key === "upsert" };
        }
        const next = v.apply(q, args);
        return next && typeof next === "object" ? wrapQuery(next, table, nextWrite) : next;
      };
    },
  });
}
function client(db) {
  return new Proxy(db, {
    get(target, key) {
      if (key === "from") return (table) => wrapQuery(target.from(table), table);
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
function queryString(table, query) {
  const f = flag();
  return f !== null && TABLES.has(table)
    ? query +
        (query ? "&" : "") +
        "is_test=eq." +
        String(table === "auth_sessions" ? !!current().isTestAccount : f)
    : query;
}
async function activeBranch() {
  const r = await base()
    .from("branches")
    .select("id")
    .eq("is_test", true)
    .order("created_at")
    .limit(1);
  if (r.error) throw r.error;
  return r.data?.[0]?.id || null;
}
async function gate(req, seg) {
  const s = current(),
    p = new URL(req.url, "http://x").pathname,
    parts = p.split("/").filter(Boolean),
    mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (
    s.mode === "test" &&
    ["backups", "admin-migrations", "import-rows", "admin-bot", "renewals"].includes(seg)
  )
    throw new HttpError(
      403,
      "TEST_OPERATION_FORBIDDEN",
      "测试范围不能访问备份、迁移、导入或正式智能助手",
    );
  const pathId = parts.find((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (pathId && PATHS[seg])
    await target(
      seg === "families" && parts.includes("students") ? "students" : PATHS[seg],
      pathId,
    );
  if (mutating) {
    await guardRows("", req.body || {});
    if (seg === "packages" && parts[0] === "types" && pathId) await target("package_types", pathId);
    if (seg === "finance" && parts[0] === "student" && pathId) await target("students", pathId);
    if (seg === "accounts" && req.body?.id) await target("profiles", req.body.id);
    for (const rule of req.body?.rules || []) await guardRows("", rule);
  }
}
async function filterSalaryRecords(value) {
  if (flag() === null) return value;
  const r = await require("./supabase.js").getAdmin().from("teachers").select("profile_id");
  if (r.error) throw r.error;
  const ids = new Set((r.data || []).map((x) => x.profile_id));
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key, v]) => ids.has(v.teacher_id || key.split("_")[0])),
  );
}
async function runRequest(req, res, seg, handler) {
  if (
    ["auth", "health", "client-errors"].includes(seg) ||
    (seg === "leads" && req.method === "POST" && !req.headers.authorization)
  )
    return handler(req, res);
  await require("./auth.js").requireAuth(req, res);
  const isTestAccount = !!req.context.isTestAccount;
  let mode = isTestAccount
    ? "test"
    : req.context.role === "admin" && ["test"].includes(req.headers["x-data-scope"])
      ? req.headers["x-data-scope"]
      : "production";
  const testBranchId =
    mode === "test" ? (isTestAccount ? req.context.branchId : await activeBranch()) : null;
  if (mode === "test" && !testBranchId)
    throw new HttpError(409, "TEST_BRANCH_UNAVAILABLE", "没有可用的模拟校区");
  const context = { mode, isTestAccount, testBranchId, userId: req.context.userId, seg };
  if (mode === "test") req.context.branchId = testBranchId;
  req.context.dataScope = mode;
  return storage.run(context, async () => {
    await gate(req, seg);
    res.setHeader("x-data-scope", mode);
    return handler(req, res);
  });
}
function runSystem(mode, run) {
  return storage.run({ mode, isTestAccount: false }, run);
}
module.exports = {
  current,
  client,
  apply,
  queryString,
  guardExisting,
  guardRows,
  prepareRows,
  target,
  filterSalaryRecords,
  runRequest,
  runSystem,
};
