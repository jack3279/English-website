// /notifications: 站内通知中心
// Worker 走 service_role (绕过 RLS), 所以可见性必须在代码里按 target_user / target_role 过滤
// 已读用 notification_reads 表, 批量已读一次 INSERT 完成 (免费档子请求 50/请求, 不能逐条更新)
const { ok, badRequest, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restInsert } = require("../lib/rest.js");
const { z } = require("zod");
const preferences = require("../lib/notificationPreferences.js");
const { HttpError } = require("../lib/errors.js");
const { positiveIntParam } = require("../lib/pagination.js");

const TYPES = [
  "lesson_reminder",
  "lesson_rescheduled",
  "lesson_cancelled",
  "class_report",
  "renewal",
  "leave",
  "makeup",
  "lead",
  "message",
  "system",
];

const CreateInput = z.object({
  type: z.enum(TYPES).default("system"),
  title: z.string().min(1).max(120),
  body: z.string().max(2000).optional().nullable(),
  target_user: z.string().uuid().optional().nullable(),
  target_role: z.enum(["admin", "teacher", "parent"]).optional().nullable(),
  student_id: z.string().uuid().optional().nullable(),
  link: z.string().max(200).optional().nullable(),
});

const ReadInput = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
});

const SELECT_COLS = "id,type,title,body,target_user,target_role,student_id,link,created_at";

// 可见性: 定向 > 角色广播 > 全员
function visibleTo(row, userId, role) {
  if (row.target_user) return row.target_user === userId;
  if (row.target_role) return row.target_role === role;
  return true;
}

function visibleQuery(query, userId, role) {
  return query.or(
    `target_user.eq.${userId},target_role.eq.${role},and(target_user.is.null,target_role.is.null)`,
  );
}

// 原 rawBase / restHeaders 已删除: 手写 PostgREST 的唯一用处(标已读)已收敛到
// lib/rest.js 的 restInsert, 留着只会又变成第二个「自己拼 header」的入口。
async function fetchVisible(userId, role, { pageSize = 500, maxRows = 10000 } = {}) {
  const admin = getAdmin();
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await visibleQuery(
      admin.from("notifications").select(SELECT_COLS),
      userId,
      role,
    )
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []).filter((r) => visibleTo(r, userId, role)));
    if ((data ?? []).length < pageSize) return rows;
  }
  throw new HttpError(503, "NOTIFICATION_RANGE_TOO_LARGE", "通知范围过大，请稍后再试");
}

async function fetchReadSet(userId, ids) {
  if (!ids.length) return new Set();
  const admin = getAdmin();
  const read = new Set();
  for (let start = 0; start < ids.length; start += 500) {
    const { data, error } = await admin
      .from("notification_reads")
      .select("notification_id")
      .eq("user_id", userId)
      .in("notification_id", ids.slice(start, start + 500));
    if (error) throw error;
    for (const row of data ?? []) read.add(row.notification_id);
  }
  return read;
}


module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();
  await requireAuth(req, res);
  const { userId, role } = req.context;

  // GET /notifications?limit=50
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
    // 上限对齐通知管理页的 limit=200；铃铛用 50。行数不增加子请求，免费档无影响。
    const limit = positiveIntParam(url.searchParams.get("limit"), 50, 200);
    const rows = await fetchVisible(userId, role);
    const readSet = await fetchReadSet(
      userId,
      rows.map((r) => r.id),
    );
    const prefs = await preferences.read(userId);
    const items = rows
      .slice(0, limit)
      .map((r) => ({ ...r, read: readSet.has(r.id), muted: preferences.muted(r, prefs) }));
    const unreadTotal = rows.reduce((n, r) => n + (readSet.has(r.id) ? 0 : 1), 0);
    const unread = rows.reduce(
      (n, r) => n + (readSet.has(r.id) || preferences.muted(r, prefs) ? 0 : 1),
      0,
    );
    ok(res, { items, unread, unreadTotal });
    return;
  }

  // GET /notifications/unread-count
  if (req.method === "GET" && url.pathname === "/unread-count") {
    const rows = await fetchVisible(userId, role);
    const readSet = await fetchReadSet(
      userId,
      rows.map((r) => r.id),
    );
    const prefs = await preferences.read(userId);
    ok(res, {
      count: rows.reduce(
        (n, r) => n + (readSet.has(r.id) || preferences.muted(r, prefs) ? 0 : 1),
        0,
      ),
    });
    return;
  }

  // POST /notifications/read   body: { ids?: string[] }  不传 ids = 全部已读
  if (req.method === "POST" && url.pathname === "/read") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = ReadInput.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const rows = await fetchVisible(userId, role);
    const wanted = parsed.data.ids ? new Set(parsed.data.ids) : null;
    const targets = rows.filter((r) => (wanted ? wanted.has(r.id) : true)).map((r) => r.id);
    if (!targets.length) {
      ok(res, { updated: 0 });
      return;
    }
    const readSet = await fetchReadSet(userId, targets);
    const fresh = targets.filter((id) => !readSet.has(id));
    if (!fresh.length) {
      ok(res, { updated: 0 });
      return;
    }
    // 统一走 lib/rest.js。这里原来手写了一份 PostgREST POST ——
    // notification_reads 是**复合主键**(user_id, notification_id), 靠
    // resolution=ignore-duplicates 让重复标记变成无操作(而不是 409)。
    // 这段语义交给 restInsert 的 prefer 参数承载, 不再自己拼 header。
    let updated = 0;
    for (let start = 0; start < fresh.length; start += 500) {
      await restInsert(
        "notification_reads",
        fresh.slice(start, start + 500).map((id) => ({ user_id: userId, notification_id: id })),
        "return=minimal,resolution=ignore-duplicates",
      );
      updated += Math.min(500, fresh.length - start);
    }
    ok(res, { updated });
    return;
  }

  // POST /notifications  (admin 发通知)
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "")) {
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = CreateInput.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const { data, error } = await admin
      .from("notifications")
      .insert({ ...parsed.data, created_by: userId })
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw error;
    ok(res, data);
    return;
  }

  forbidden(res, "unknown notifications route");
};
