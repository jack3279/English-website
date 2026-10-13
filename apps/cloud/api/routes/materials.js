// /materials 学习内容 / 教材
// kind: file(存 R2/Storage, 只留 url 或 storage_path) | link | text
// student_id 为空 = 通用教材; 有值 = 定向发给该学员
// 可见性: admin 全看；老师只看通用教材 + 自己可见学员的定向教材；家长只看"通用 + 自己孩子的"
// 写权限: /content 对老师与家长都是只读视图, 只有管理员能发布/删除
const { ok, badRequest, forbidden, notFound } = require("../lib/http.js");
const { requireAuth } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restDelete } = require("../lib/rest.js");
const { visibleStudentIds } = require("../lib/scoping.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");

const UUID = /^[0-9a-f-]{36}$/i;
const SELECT =
  "id,title,description,student_id,course_id,kind,url,storage_path,content,created_by,created_at";

const CreateInput = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  student_id: z.string().uuid().optional().nullable(),
  course_id: z.string().uuid().optional().nullable(),
  kind: z.enum(["file", "link", "text"]).default("file"),
  url: z.string().max(2000).optional().nullable(),
  storage_path: z.string().max(500).optional().nullable(),
  content: z.string().max(20000).optional().nullable(),
});

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
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();
  const studentId = url.searchParams.get("student_id");
  const courseId = url.searchParams.get("course_id");

  let q = admin.from("materials").select(SELECT);
  if (studentId) q = q.eq("student_id", studentId);
  if (courseId) q = q.eq("course_id", courseId);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  let rows = data ?? [];

  if (req.context.role !== "admin") {
    const ids = await visibleStudentIds(req);
    const allowed = new Set(ids ?? []);
    rows = rows.filter((m) => !m.student_id || allowed.has(m.student_id));
  }

  const ids = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: stu } = await admin.from("students").select("id, full_name").in("id", ids);
    names = Object.fromEntries((stu ?? []).map((s) => [s.id, s.full_name]));
  }

  ok(res, {
    items: rows.map((r) => ({
      ...r,
      student_name: r.student_id ? (names[r.student_id] ?? null) : null,
    })),
    total: rows.length,
  });
}

async function create(req, res) {
  await requireAuth(req, res);
  // 产品口径: /content 对老师与家长都是只读视图, 教材统一由管理员发布
  if (req.context.role !== "admin") {
    forbidden(res, "只有管理员可以发布教材");
    return;
  }
  const parsed = CreateInput.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  if (parsed.data.kind === "link" && !parsed.data.url) {
    badRequest(res, "link 类型必须提供 url");
    return;
  }
  if (parsed.data.kind === "file" && !parsed.data.url && !parsed.data.storage_path) {
    badRequest(res, "file 类型必须提供 url 或 storage_path");
    return;
  }
  if (parsed.data.kind === "text" && !parsed.data.content) {
    badRequest(res, "text 类型必须提供 content");
    return;
  }
  const { data, error } = await getAdmin()
    .from("materials")
    .insert({ ...parsed.data, created_by: req.context.userId })
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  await audit(
    req.context.userId,
    "material.create",
    "material",
    data.id,
    { title: data.title },
    req.reqId,
  );
  ok(res, data);
}

async function remove(req, res, id) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "只有管理员可以删除教材");
    return;
  }
  if (!UUID.test(id)) {
    badRequest(res, "id 不合法");
    return;
  }
  const rows = await restDelete("materials", { id });
  if (!rows?.length) {
    notFound(res, "教材不存在");
    return;
  }
  await audit(req.context.userId, "material.delete", "material", id, null, req.reqId);
  ok(res, { deleted: true, id });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const seg = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (req.method === "GET") return list(req, res);
  if (req.method === "POST") return create(req, res);
  if (req.method === "DELETE" && seg) return remove(req, res, seg);
  forbidden(res, "unknown materials route");
};
