const { ok, badRequest, notFound, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const notify = require("../lib/notify.js");
const { visibleStudentIds } = require("../lib/scoping.js");
const { HttpError } = require("../lib/errors.js");
async function allowedRecipient(req, recipient) {
  if (req.context.role === "admin") return true;
  if (recipient.role === "admin")
    return !recipient.branch_id || recipient.branch_id === req.context.branchId;
  const ids = await visibleStudentIds(req);
  if (!ids.length) return false;
  const db = getAdmin();
  if (req.context.role === "parent" && recipient.role === "teacher") {
    const results = await Promise.all([
      db.from("courses").select("id").eq("teacher_id", recipient.id).in("student_id", ids).limit(1),
      db.from("lessons").select("id").eq("teacher_id", recipient.id).in("student_id", ids).limit(1),
    ]);
    if (results.some((r) => r.error))
      throw new HttpError(503, "MESSAGE_SCOPE_UNAVAILABLE", "授课关系暂时无法确认");
    return results.some((r) => r.data?.length);
  }
  if (req.context.role === "teacher" && recipient.role === "parent") {
    const r = await db
      .from("parent_student_links")
      .select("student_id,parents!inner(profile_id)")
      .eq("parents.profile_id", recipient.id)
      .in("student_id", ids)
      .limit(1);
    if (r.error) throw new HttpError(503, "MESSAGE_SCOPE_UNAVAILABLE", "监护关系暂时无法确认");
    return !!r.data?.length;
  }
  return false;
}
const { restPatch, restInsert } = require("../lib/rest.js");
const { z } = require("zod");

const SendInput = z.object({
  to_user: z.string().uuid(),
  subject: z.string().max(120).optional().nullable(),
  body: z.string().min(1).max(2000),
});

// 家长给「学校」留言时, 正文校验 (收件人由后端按 branch 解析, 不接受前端指定)。
const SchoolBody = z.object({ body: z.string().min(1).max(2000) });

// 解析「学校 / 教务」：与该用户同 branch 的所有 admin。
// 家长只能联系机构, 不指定具体某位老师; 多 admin 时上层据此 fan-out。
async function branchAdmins(admin, userId) {
  const { data: me, error: profileError } = await admin
    .from("profiles")
    .select("branch_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new HttpError(503, "SCHOOL_UNAVAILABLE", "学校联系渠道暂时无法确认");
  if (!me?.branch_id) return [];
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("branch_id", me.branch_id)
    .eq("role", "admin");
  if (error) throw new HttpError(503, "SCHOOL_UNAVAILABLE", "学校联系渠道暂时无法确认");
  return data ?? [];
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();

  // All routes require auth (站内信不是公开的)
  await requireAuth(req, res);
  const { userId, role } = req.context;

  // GET /messages/school-thread —— 家长与「学校」的聚合会话 (双向, 时间正序)
  if (req.method === "GET" && url.pathname === "/school-thread") {
    requireRole(req, res, "parent", "teacher");
    const admins = await branchAdmins(admin, userId);
    const ids = admins.map((a) => a.id);

    let sent = [];
    let got = [];
    if (ids.length) {
      // 分两条简单查询再在 JS 合并, 比拼嵌套 or/and 过滤串更稳更好读。
      const { data: d1 } = await admin
        .from("internal_messages")
        .select("id, to_user, from_user, body, read_at, created_at")
        .eq("from_user", userId)
        .in("to_user", ids);
      const { data: d2 } = await admin
        .from("internal_messages")
        .select("id, to_user, from_user, body, read_at, created_at")
        .in("from_user", ids)
        .eq("to_user", userId);
      sent = d1 ?? [];
      got = d2 ?? [];
    }

    // 进入会话即把学校发来的未读消息置为已读, 清掉角标。
    const unreadIds = got.filter((m) => !m.read_at).map((m) => m.id);
    if (unreadIds.length) {
      await restPatch(
        "internal_messages",
        `id=in.(${unreadIds.join(",")})&to_user=eq.${userId}`,
        { read_at: new Date().toISOString() },
        "return=minimal",
      );
    }

    const messages = [...sent, ...got]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((m) => ({
        id: m.id,
        body: m.body,
        created_at: m.created_at,
        from_user: m.from_user,
        mine: m.from_user === userId,
      }));

    ok(res, {
      admins: admins.map((a) => ({ id: a.id, full_name: a.full_name })),
      messages,
    });
    return;
  }

  // GET /messages?status=unread
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
    const status = url.searchParams.get("status");
    const limit = Math.min(200, Number(url.searchParams.get("limit") || 100));
    let q = admin
      .from("internal_messages")
      .select("id, to_user, from_user, subject, body, read_at, created_at")
      .eq("to_user", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status === "unread") q = q.is("read_at", null);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    // 单独查 sender profiles (避免 join 在 from_user 字段缺时 500)
    const senderIds = [...new Set(rows.map((r) => r.from_user).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length) {
      const { data: senders } = await admin
        .from("profiles")
        .select("id, full_name, role")
        .in("id", senderIds);
      senderMap = Object.fromEntries((senders ?? []).map((s) => [s.id, s]));
    }
    ok(
      res,
      rows.map((r) => ({ ...r, from_user_profile: senderMap[r.from_user] ?? null })),
    );
    return;
  }

  // GET /messages/unread-count
  if (req.method === "GET" && url.pathname === "/unread-count") {
    const { count, error } = await admin
      .from("internal_messages")
      .select("id", { count: "exact", head: true })
      .eq("to_user", userId)
      .is("read_at", null);
    if (error) throw error;
    ok(res, { count: count ?? 0 });
    return;
  }

  // GET /messages/teammates (可发信对象, 同机构内其他用户)
  if (req.method === "GET" && url.pathname === "/teammates") {
    requireRole(req, res, "admin");
    // 先查自己 branch_id, 再列出同 branch 其他 profiles
    const { data: me } = await admin
      .from("profiles")
      .select("branch_id, role")
      .eq("id", userId)
      .maybeSingle();
    if (!me?.branch_id) {
      ok(res, []);
      return;
    }
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, role, phone")
      .eq("branch_id", me.branch_id)
      .neq("id", userId)
      .order("role")
      .order("full_name");
    if (error) throw error;
    ok(res, data ?? []);
    return;
  }

  // POST /messages/school —— 家长给「学校」留言; 多 admin 时 fan-out, 保证人人可见
  if (req.method === "POST" && url.pathname === "/school") {
    requireRole(req, res, "parent", "teacher");
    const parsed = SchoolBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, "参数不合法", parsed.error.flatten());
      return;
    }
    const text = parsed.data.body;
    const admins = await branchAdmins(admin, userId);
    if (!admins.length) {
      badRequest(res, "学校账号未配置，请直接联系教务老师");
      return;
    }

    const rows = admins.map((a) => ({
      to_user: a.id,
      from_user: userId,
      subject: null,
      body: text,
    }));
    const inserted = await restInsert("internal_messages", rows);

    // 每位 admin 一条通知 (失败不阻断主流程, notify 内部已吞错)
    await Promise.all(
      (inserted ?? []).map((m, i) =>
        notify.push(
          {
            type: "message",
            title: "家长留言",
            body: text,
            target_user: admins[i].id,
            link: "/admin/messages",
          },
          { reqId: req.reqId, source: "messages.school", messageId: m.id },
        ),
      ),
    );

    ok(res, { delivered: inserted?.length ?? admins.length });
    return;
  }

  // POST /messages
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "")) {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = SendInput.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    // 验证收件人存在
    const { data: recipient } = await admin
      .from("profiles")
      .select("id,role,branch_id")
      .eq("id", parsed.data.to_user)
      .maybeSingle();
    if (!recipient) {
      badRequest(res, "收件人不存在");
      return;
    }
    if (!(await allowedRecipient(req, recipient))) {
      forbidden(res, "只能联系本校教务或关联课程的教师、家长");
      return;
    }
    const { data, error } = await admin
      .from("internal_messages")
      .insert({
        to_user: parsed.data.to_user,
        from_user: userId,
        subject: parsed.data.subject || null,
        body: parsed.data.body,
      })
      .select()
      .maybeSingle();
    if (error) throw error;

    // 通知收件人: 否则对方只有主动点进消息页才知道有新消息（家长基本不会主动看）
    await notify.push(
      {
        type: "message",
        title: parsed.data.subject || "收到一条新消息",
        body: parsed.data.body,
        target_user: parsed.data.to_user,
        link: "/messages",
      },
      { reqId: req.reqId, source: "messages.create", messageId: data?.id },
    );

    ok(res, data);
    return;
  }

  // PATCH /messages/:id (标记已读)
  // 只收 UUID 形状: 这里原来用 ([^/]+), 而 id 会被拼进 PostgREST 过滤串 ——
  // 宽松的捕获等于把查询串的一部分交给调用方拼。收窄成 UUID 形状堵掉这条路。
  const m = url.pathname.match(/^\/([0-9a-fA-F-]{36})$/);
  if (req.method === "PATCH" && m) {
    const id = m[1];
    // 先查这条消息是不是我的
    const { data: msg } = await admin
      .from("internal_messages")
      .select("id, to_user, read_at")
      .eq("id", id)
      .maybeSingle();
    if (!msg) {
      notFound(res, "消息不存在");
      return;
    }
    if (msg.to_user !== userId) {
      forbidden(res, "只能标记自己的消息已读");
      return;
    }
    if (msg.read_at) {
      ok(res, msg); // 已经是已读
      return;
    }
    // 统一走 lib/rest.js: 之前这里手写了一份 PostgREST PATCH,
    // 与 restPatch 各维护一套 header 与错误处理, 迟早长歪。
    // 过滤条件带上 to_user 作为第二重保险(即使上面的检查被绕过也改不到别人的信)。
    const rows = await restPatch(
      "internal_messages",
      { id, to_user: userId },
      { read_at: new Date().toISOString() },
    );
    if (Array.isArray(rows) && rows.length > 0) {
      ok(res, rows[0]);
      return;
    }
    // 没更新成功 (未知原因), 返原 row
    const { data: cur } = await admin
      .from("internal_messages")
      .select("id, to_user, from_user, subject, body, read_at, created_at")
      .eq("id", id)
      .maybeSingle();
    ok(res, cur);
    return;
  }

  forbidden(res, "unknown messages route");
};
