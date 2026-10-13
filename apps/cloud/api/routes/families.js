const { z } = require("zod");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restInsert, restDelete } = require("../lib/rest.js");
const { HttpError } = require("../lib/errors.js");
const { ok, notFound } = require("../lib/http.js");
const { record: audit } = require("../lib/audit.js");
const { listAuthUsers } = require("./accounts.js");
async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function studentExists(id) {
  const found = await rows(getAdmin().from("students").select("id").eq("id", id).limit(1));
  if (!found.length) throw new HttpError(404, "STUDENT_NOT_FOUND", "没有找到该学员");
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const url = new URL(req.url, "http://x"),
    path = url.pathname.replace(/^\/families/, "");
  if (path === "/parents" && req.method === "GET") {
    const [registry, authUsers] = await Promise.all([
      rows(
        getAdmin()
          .from("parents")
          .select("id,profile_id,full_name,profiles:profile_id(phone,role)")
          .order("full_name")
          .limit(1000),
      ),
      listAuthUsers(),
    ]);
    const emails = new Map(authUsers.map((user) => [user.id, user.email]));
    ok(
      res,
      registry
        .filter((row) => row.profiles?.role === "parent")
        .map((row) => ({
          id: row.id,
          profileId: row.profile_id,
          name: row.full_name,
          phone: row.profiles?.phone || null,
          email: emails.get(row.profile_id) || null,
        })),
    );
    return;
  }
  const match = path.match(/^\/students\/([a-f0-9-]{36})(?:\/parents\/([a-f0-9-]{36}))?$/i);
  if (!match) {
    notFound(res);
    return;
  }
  const id = match[1],
    parentId = match[2];
  await studentExists(id);
  if (req.method === "GET" && !parentId) {
    const links = await rows(
      getAdmin()
        .from("parent_student_links")
        .select("parent_id,relation,parents(id,profile_id,full_name,profiles:profile_id(phone))")
        .eq("student_id", id),
    );
    const authUsers = links.length ? await listAuthUsers() : [],
      emails = new Map(authUsers.map((user) => [user.id, user.email]));
    ok(
      res,
      links.map((row) => ({
        id: row.parent_id,
        relation: row.relation,
        name: row.parents?.full_name || "家长",
        profileId: row.parents?.profile_id,
        phone: row.parents?.profiles?.phone || null,
        email: emails.get(row.parents?.profile_id) || null,
      })),
    );
    return;
  }
  if (req.method === "POST" && !parentId) {
    const checked = z
      .object({
        parent_id: z.string().uuid(),
        relation: z.enum(["mother", "father", "guardian"]).default("guardian"),
        confirmed: z.literal(true),
      })
      .strict()
      .safeParse(req.body);
    if (!checked.success) throw new HttpError(400, "BAD_REQUEST", "请选择家长并确认监护关系");
    const input = checked.data;
    const parents = await rows(
      getAdmin()
        .from("parents")
        .select("id,profiles:profile_id(role)")
        .eq("id", input.parent_id)
        .limit(1),
    );
    if (!parents.length || parents[0].profiles?.role !== "parent")
      throw new HttpError(404, "PARENT_NOT_FOUND", "没有找到有效的家长账号");
    const existing = await rows(
      getAdmin()
        .from("parent_student_links")
        .select("parent_id")
        .eq("student_id", id)
        .eq("parent_id", input.parent_id)
        .limit(1),
    );
    if (!existing.length) {
      try {
        await restInsert("parent_student_links", {
          student_id: id,
          parent_id: input.parent_id,
          relation: input.relation,
        });
      } catch (error) {
        // 并发重复点击由复合主键保护，只有确认关联存在后才视为已完成。
        const persisted = await rows(
          getAdmin()
            .from("parent_student_links")
            .select("parent_id")
            .eq("student_id", id)
            .eq("parent_id", input.parent_id)
            .limit(1),
        );
        if (!persisted.length) throw error;
      }
    }
    await audit(
      req.context.userId,
      "family.linked",
      "student",
      id,
      { parent_id: input.parent_id },
      req.reqId,
    );
    ok(res, {
      linked: true,
      message: existing.length
        ? "该家长已经关联，无需重复绑定"
        : "家长已绑定，可登录查看该孩子的课程",
    });
    return;
  }
  if (req.method === "DELETE" && parentId) {
    if (req.body?.confirmed !== true)
      throw new HttpError(400, "CONFIRM_REQUIRED", "请确认解除该家长与孩子的关联");
    await restDelete("parent_student_links", { student_id: id, parent_id: parentId });
    await audit(
      req.context.userId,
      "family.unlinked",
      "student",
      id,
      { parent_id: parentId },
      req.reqId,
    );
    ok(res, { unlinked: true, message: "关联已解除，学员和家长账号仍保留" });
    return;
  }
  notFound(res);
};
