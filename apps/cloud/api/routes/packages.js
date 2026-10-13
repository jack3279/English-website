const { ok, badRequest, notFound, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restDelete } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const { warn } = require("../lib/log.js");
const { parseExpiresAt } = require("../lib/window.js");
const { z } = require("zod");
const { canSeeStudent } = require("../lib/scoping.js");
const { executeFinancialRequest } = require("../lib/financialRequests.js");

const packageTypeSchema = z.object({
  name: z.string().min(1).max(80),
  hours: z.number().positive().max(9999.99),
  price_cents: z.number().int().min(0),
  active: z.boolean().optional(),
});

const studentPackageSchema = z.object({
  student_id: z.string().uuid(),
  package_type_id: z.string().uuid().optional().nullable(),
  total_hours: z.number().positive().max(9999.99),
  remaining_hours: z.number().min(0).max(9999.99),
  expires_at: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const purchaseSchema = z.object({
  student_id: z.string().uuid(),
  package_type_id: z.string().uuid(),
  amount_cents: z.number().int().min(0),
  method: z.string().max(40).optional().nullable(),
  notes: z.string().max(200).optional().nullable(),
  // 有效期。**必须是可选的但一定要能被设上** —— 早先这里没有它, 于是买出来的课时包
  // 永远不过期, pickRenewalAlerts 里「30 天内到期」那一支从来没触发过。
  // 收字符串(ISO 或 YYYY-MM-DD), 由下面解析成 timestamptz。
  expires_at: z.string().max(40).optional().nullable(),
});

const refundSchema = z.object({
  student_package_id: z.string().uuid(),
  hours: z.number().positive().max(9999.99),
  amount_cents: z.number().int().min(0),
  method: z.string().max(40).optional().nullable(),
  notes: z.string().trim().min(1).max(200),
});

const paymentSchema = z.object({
  student_package_id: z.string().uuid().optional().nullable(),
  student_id: z.string().uuid(),
  amount_cents: z.number().int().min(0),
  method: z.string().max(40).optional().nullable(),
  notes: z.string().max(200).optional().nullable(),
});

async function handlePackages(req, res) {
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();

  // GET /packages/types (admin/teacher)
  if (req.method === "GET" && url.pathname === "/types") {
    await requireAuth(req, res);
    // 注释写的是 admin/teacher，实现却只有 requireAuth —— 任何登录角色（含家长）
    // 都能读到全部课程包与定价。补上 requireRole，让实现与注释一致。
    // ⚠️ 这不是新收紧：前端入口本就只有 admin，是后端一直漏了角色校验。
    requireRole(req, res, "admin", "teacher");
    const { data, error } = await admin
      .from("package_types")
      .select("id, name, hours, price_cents, active, created_at")
      .order("active", { ascending: false })
      .order("hours");
    if (error) throw error;
    ok(res, data ?? []);
    return;
  }

  // POST /packages/types (admin only)
  if (req.method === "POST" && url.pathname === "/types") {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = packageTypeSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const { data, error } = await admin
      .from("package_types")
      .insert(parsed.data)
      .select()
      .maybeSingle();
    if (error) throw error;
    ok(res, data);
    return;
  }

  // PATCH /packages/types/:id (admin only)
  const mType = url.pathname.match(/^\/types\/([^/]+)$/);
  if (req.method === "PATCH" && mType) {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = packageTypeSchema.partial().safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const rows = await restPatch("package_types", { id: mType[1] }, parsed.data);
    // PostgREST PATCH 打不存在的行照样返 200。不校验行数的话，
    // 前端会看到「保存成功」而实际什么都没改（用户以为改好了，下次又改一遍）。
    if (!rows?.length) {
      notFound(res, "课程包不存在");
      return;
    }
    ok(res, rows[0]);
    return;
  }

  // DELETE /packages/types/:id (admin only)
  if (req.method === "DELETE" && mType) {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    // 同理：DELETE 0 行也是 200，必须校验，否则删一个已不存在的 id 会回报成功
    const rows = await restDelete("package_types", { id: mType[1] });
    if (!rows?.length) {
      notFound(res, "课程包不存在");
      return;
    }
    ok(res, { deleted: true });
    return;
  }

  // GET /packages/student/:studentId
  const mSp = url.pathname.match(/^\/student\/([^/]+)$/);
  if (req.method === "GET" && mSp) {
    await requireAuth(req, res);
    if (!(await canSeeStudent(req, mSp[1]))) {
      notFound(res, "学员不存在");
      return;
    }
    const { data, error } = await admin
      .from("student_packages")
      .select(
        "id, student_id, package_type_id, total_hours, remaining_hours, purchased_at, expires_at, notes, package_types(name, hours, price_cents)",
      )
      .eq("student_id", mSp[1])
      .order("purchased_at", { ascending: false });
    if (error) throw error;
    ok(res, data ?? []);
    return;
  }

  // POST /packages/student（管理员开课包）
  if (req.method === "POST" && url.pathname === "/student") {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = studentPackageSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const { data, error } = await admin
      .from("student_packages")
      .insert(parsed.data)
      .select()
      .maybeSingle();
    if (error) throw error;
    ok(res, data);
    return;
  }

  // POST /packages/payment (admin 录入缴费)
  if (req.method === "POST" && url.pathname === "/payment") {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const { userId } = req.context;
    const { data, error } = await admin
      .from("package_payments")
      .insert({ ...parsed.data, recorded_by: userId })
      .select()
      .maybeSingle();
    if (error) throw error;
    ok(res, data);
    return;
  }

  // GET /packages/payments/:studentId
  const mPay = url.pathname.match(/^\/payments\/([^/]+)$/);
  if (req.method === "GET" && mPay) {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "parent");
    if (!(await canSeeStudent(req, mPay[1]))) {
      notFound(res, "学员不存在");
      return;
    }
    const { data, error } = await admin
      .from("package_payments")
      .select("id, student_package_id, student_id, amount_cents, method, paid_at, notes")
      .eq("student_id", mPay[1])
      .order("paid_at", { ascending: false });
    if (error) throw error;
    ok(res, data ?? []);
    return;
  }

  // GET /packages/types/:id — 单个 type 详情 (含销售统计)
  const mTypeId = url.pathname.match(/^\/types\/([^/]+)$/);
  if (req.method === "GET" && mTypeId) {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const { data: type, error } = await admin
      .from("package_types")
      .select("id, name, hours, price_cents, active, created_at")
      .eq("id", mTypeId[1])
      .maybeSingle();
    if (error) throw error;
    if (!type) {
      notFound(res, "课时包不存在");
      return;
    }

    // 销售统计: 卖了几份, 总收入
    const { data: sales } = await admin
      .from("student_packages")
      .select("id, student_id, total_hours, remaining_hours, purchased_at, students(full_name)")
      .eq("package_type_id", mTypeId[1])
      .order("purchased_at", { ascending: false })
      .limit(200);
    const { count } = await admin
      .from("student_packages")
      .select("id", { count: "exact", head: true })
      .eq("package_type_id", mTypeId[1]);
    const { data: payments } = await admin
      .from("package_payments")
      .select("amount_cents, paid_at")
      .in(
        "student_package_id",
        (sales ?? []).map((s) => s.id),
      );
    const totalRevenue = (payments ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);
    ok(res, {
      ...type,
      sold_count: count ?? (sales?.length || 0),
      total_revenue_cents: totalRevenue,
      sales: sales ?? [],
    });
    return;
  }

  // POST /packages/purchase — 原子化: 创 student_package + 录 package_payment
  if (req.method === "POST" && url.pathname === "/purchase") {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = purchaseSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    // 校验学员存在。**必须显式查一次**: 不查的话, 学员 id 不存在时 student_packages
    // 的插入会撞外键约束, 冒上来是一个 500「服务器错误」—— 教务完全不知道发生了什么。
    const { data: stu } = await admin
      .from("students")
      .select("id, full_name")
      .eq("id", parsed.data.student_id)
      .maybeSingle();
    if (!stu) {
      notFound(res, "学员不存在（可能已被删除）");
      return;
    }

    // 校验 package_type 存在 + active
    const { data: pt, error: ptErr } = await admin
      .from("package_types")
      .select("id, hours, active, name")
      .eq("id", parsed.data.package_type_id)
      .maybeSingle();
    if (ptErr) throw ptErr;
    if (!pt) {
      badRequest(res, "课时包类型不存在");
      return;
    }
    if (!pt.active) {
      badRequest(res, "该课时包已下架");
      return;
    }

    // 有效期: 纯日期按当天结束(+08:00 23:59:59)解释, 见 lib/window.js 的注释。
    const exp = parseExpiresAt(parsed.data.expires_at);
    if (exp.bad) {
      badRequest(res, exp.bad);
      return;
    }

    // Step 1: 创建 student_package (remaining = total)
    const { data: sp, error: spErr } = await admin
      .from("student_packages")
      .insert({
        student_id: parsed.data.student_id,
        package_type_id: parsed.data.package_type_id,
        total_hours: pt.hours,
        remaining_hours: pt.hours,
        expires_at: exp.iso,
        notes: parsed.data.notes ?? null,
      })
      .select()
      .maybeSingle();
    if (spErr) throw spErr;

    // Step 2: 创建 package_payment (link to sp)
    const { data: pay, error: payErr } = await admin
      .from("package_payments")
      .insert({
        student_package_id: sp.id,
        student_id: parsed.data.student_id,
        amount_cents: parsed.data.amount_cents,
        method: parsed.data.method ?? null,
        notes: parsed.data.notes ?? null,
        recorded_by: req.context.userId,
      })
      .select()
      .maybeSingle();
    if (payErr) {
      // rollback (尽力而为: 失败只告警, 不掩盖原始错误)
      try {
        await restDelete("student_packages", { id: sp.id });
      } catch (e) {
        warn("rollback_delete_failed", { table: "student_packages", err: e.message });
      }
      throw payErr;
    }

    ok(res, { student_package: sp, payment: pay });
    return;
  }

  // POST /packages/refund — 从指定课时包扣剩余课时，并记一笔退款（金额可为 0）。
  // 余额视图 = 各包 remaining_hours − 与课节绑定的 consume/refund 流水。
  // 这里只改包内剩余，流水不绑课节，避免同一笔退费被减两次。
  if (req.method === "POST" && url.pathname === "/refund") {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = refundSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const { data: sp, error: spErr } = await admin
      .from("student_packages")
      .select("id, student_id, remaining_hours, total_hours")
      .eq("id", parsed.data.student_package_id)
      .maybeSingle();
    if (spErr) throw spErr;
    if (!sp) {
      notFound(res, "课时包不存在");
      return;
    }
    if (!req.__refundLock && require("../lib/secureStore.js").ready()) {
      return require("../lib/workflowLock.js").withLock(`student-${sp.student_id}`, async () => {
        req.__refundLock = true;
        try {
          return await handlePackages(req, res);
        } finally {
          delete req.__refundLock;
        }
      });
    }
    const left = Number(sp.remaining_hours);
    const hours = Math.round(parsed.data.hours * 100) / 100;
    const { data: balance, error: balanceErr } = await admin
      .from("student_balance")
      .select("remaining_hours")
      .eq("student_id", sp.student_id)
      .maybeSingle();
    if (balanceErr) throw balanceErr;
    const refundable = Math.min(left, Math.max(0, Number(balance?.remaining_hours ?? 0)));
    if (hours - refundable > 0.001) {
      badRequest(res, `最多可退 ${refundable} 小时（已扣除实际消课）`);
      return;
    }
    const next = Math.round((left - hours) * 100) / 100;
    const updated = await restPatch(
      "student_packages",
      { id: sp.id, remaining_hours: left },
      { remaining_hours: next },
    );
    if (!updated?.length) {
      throw new (require("../lib/errors.js").HttpError)(
        409,
        "PACKAGE_CHANGED",
        "课时包余额已变化，请刷新核对后重试",
      );
    }

    let pay = null;
    if (parsed.data.amount_cents > 0) {
      const { data, error: payErr } = await admin
        .from("package_payments")
        .insert({
          student_package_id: sp.id,
          student_id: sp.student_id,
          amount_cents: -parsed.data.amount_cents,
          method: parsed.data.method ?? null,
          notes: parsed.data.notes,
          recorded_by: req.context.userId,
        })
        .select()
        .maybeSingle();
      if (payErr) {
        try {
          await restPatch("student_packages", { id: sp.id }, { remaining_hours: left });
        } catch (e) {
          warn("refund_rollback_failed", { err: e.message });
        }
        throw payErr;
      }
      pay = data;
    }

    const { error: txErr } = await admin.from("lesson_transactions").insert({
      student_id: sp.student_id,
      student_package_id: sp.id,
      delta: -hours,
      reason: "refund",
      note: parsed.data.notes,
      created_by: req.context.userId,
    });
    if (txErr) {
      try {
        await restPatch("student_packages", { id: sp.id }, { remaining_hours: left });
        if (pay?.id) await restDelete("package_payments", { id: pay.id });
      } catch (e) {
        warn("refund_rollback_failed", { err: e.message });
      }
      throw txErr;
    }

    await audit(
      req.context.userId,
      "package.refund",
      "student_package",
      sp.id,
      {
        student_id: sp.student_id,
        hours,
        amount_cents: parsed.data.amount_cents,
        remaining_hours: next,
      },
      req.reqId,
    );

    ok(res, {
      student_package_id: sp.id,
      remaining_hours: next,
      refunded_hours: hours,
      amount_cents: parsed.data.amount_cents,
      payment: pay,
    });
    return;
  }

  forbidden(res, "unknown packages route");
}
module.exports = async function handler(req, res) {
  const path = new URL(req.url, "http://x").pathname;
  if (
    req.method !== "POST" ||
    !["/purchase", "/refund"].includes(path) ||
    !req.body?.idempotency_key
  )
    return handlePackages(req, res);
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const checked = z.string().uuid().safeParse(req.body.idempotency_key);
  if (!checked.success) {
    badRequest(res, "提交编号不合法，请刷新页面后重试");
    return;
  }
  const parsed = (path === "/purchase" ? purchaseSchema : refundSchema).safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "请核对缴费或退费内容", parsed.error.flatten());
    return;
  }
  // Acquire before claiming the financial request: a busy response must remain
  // retryable with the same key, rather than leave an uncertain pending claim.
  if (path === "/refund" && !req.__refundLock && require("../lib/secureStore.js").ready()) {
    const found = await getAdmin()
      .from("student_packages")
      .select("student_id")
      .eq("id", parsed.data.student_package_id)
      .maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) {
      notFound(res, "课时包不存在");
      return;
    }
    return require("../lib/workflowLock.js").withLock(
      `student-${found.data.student_id}`,
      async () => {
        req.__refundLock = true;
        try {
          return await module.exports(req, res);
        } finally {
          delete req.__refundLock;
        }
      },
    );
  }
  const result = await executeFinancialRequest({
    actor: req.context.userId,
    operation: path.slice(1),
    key: checked.data,
    body: parsed.data,
    run: async () => {
      const captured = { status: 200, body: null };
      const response = {
        status(value) {
          captured.status = value;
          return this;
        },
        json(value) {
          captured.body = value;
          return this;
        },
        setHeader(...args) {
          res.setHeader(...args);
          return this;
        },
      };
      await handlePackages(req, response);
      return captured;
    },
  });
  res.status(result.status).json(result.body);
};
