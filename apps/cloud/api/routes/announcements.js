// /announcements 公告
// audience: null=全员 / admin / teacher / parent
// Worker 走 service_role 绕过 RLS, 可见性在代码里按 audience + branch 过滤
const { ok, badRequest, forbidden, notFound } = require("../lib/http.js");
const { requireAuth } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restDelete } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");

const UUID = /^[0-9a-f-]{36}$/i;
const SELECT = "id,title,body,audience,branch_id,pinned,published_at,created_by,created_at";

const CreateInput = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  audience: z.enum(["admin", "teacher", "parent"]).optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  pinned: z.boolean().optional(),
});

const UpdateInput = CreateInput.partial();

function body(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body || {};
}

async function list(req, res) {
  await requireAuth(req, res);
  const { role } = req.context;
  const admin = getAdmin();
  const { data, error } = await admin
    .from("announcements")
    .select(SELECT)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const items = (data ?? []).filter((a) => !a.audience || a.audience === role);
  ok(res, { items, total: items.length });
}

async function create(req, res) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "只有 admin 可以发布公告");
    return;
  }
  const parsed = CreateInput.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const { data, error } = await getAdmin()
    .from("announcements")
    .insert({ ...parsed.data, created_by: req.context.userId })
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  await audit(
    req.context.userId,
    "announcement.create",
    "announcement",
    data.id,
    { title: data.title },
    req.reqId,
  );
  ok(res, data);
}

async function update(req, res, id) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "只有 admin 可以修改公告");
    return;
  }
  if (!UUID.test(id)) {
    badRequest(res, "id 不合法");
    return;
  }
  const parsed = UpdateInput.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) {
    badRequest(res, "没有需要更新的字段");
    return;
  }
  const rows = await restPatch("announcements", { id }, patch);
  if (!rows?.length) {
    notFound(res, "公告不存在");
    return;
  }
  await audit(req.context.userId, "announcement.update", "announcement", id, patch, req.reqId);
  ok(res, rows[0]);
}

async function remove(req, res, id) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "只有 admin 可以删除公告");
    return;
  }
  if (!UUID.test(id)) {
    badRequest(res, "id 不合法");
    return;
  }
  await restDelete("announcements", { id });
  await audit(req.context.userId, "announcement.delete", "announcement", id, null, req.reqId);
  ok(res, { deleted: true, id });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const seg = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (req.method === "GET") return list(req, res);
  if (req.method === "POST") return create(req, res);
  if (!(req.method === "PATCH" || req.method === "DELETE") || !seg) {
    forbidden(res, "unknown announcements route");
    return;
  }
  return req.method === "PATCH" ? update(req, res, seg) : remove(req, res, seg);
};
