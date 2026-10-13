const { z } = require("zod");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, notFound } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const { getAdmin } = require("../lib/supabase.js");
const { canSeeStudent } = require("../lib/scoping.js");
const store = require("../lib/secureStore.js");
const { withLock } = require("../lib/workflowLock.js");
const { restInsert } = require("../lib/rest.js");
const { randomUUID } = require("node:crypto");
const CONFIG = "private/renewals/config",
  ORDERS = "private/renewals/orders";
const image = z
  .string()
  .max(700000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const configSchema = z.object({
  enabled: z.boolean(),
  recipient: z.string().trim().min(1).max(80),
  qr: image,
  instructions: z.string().max(300).default("付款时请备注学生姓名和订单编号。"),
});
const createSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  package_type_id: z.string().uuid(),
});
const proofSchema = z.object({ proof: image, note: z.string().trim().max(150).default("") });
function parse(schema, value) {
  const p = schema.safeParse(value);
  if (!p.success)
    throw new HttpError(
      400,
      "INVALID_RENEWAL",
      "请检查填写内容，图片须为 PNG、JPEG 或 WebP，且不超过约 500KB",
    );
  return p.data;
}
function visible(req, o) {
  return req.context.role === "admin" || o.parent_id === req.context.userId;
}
async function getOrder(req, id) {
  const { value } = await store.read(ORDERS, []);
  const o = value.find((x) => x.id === id && visible(req, x));
  if(o)await require('../lib/dataScope.js').target('students',o.student_id);
  if (!o) throw new HttpError(404, "NOT_FOUND", "续费订单不存在");
  const { value: assets } = await store.read(`private/renewals/assets/${id}`, {});
  return { ...o, ...assets };
}
async function saveOrder(o) {
  const { qr, proof, ...metadata } = o;
  await store.change(`private/renewals/assets/${o.id}`, {}, (a) => ({
    ...a,
    ...(qr ? { qr } : {}),
    ...(proof ? { proof } : {}),
  }));
  return store.change(ORDERS, [], (list) => list.map((x) => (x.id === o.id ? metadata : x)));
}
async function row(table, id) {
  const { data, error } = await getAdmin().from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
async function ensureRow(table, id, value) {
  const prior = await row(table, id);
  if (prior) return prior;
  try {
    const rows = await restInsert(table, { id, ...value });
    if (!rows?.length) throw new Error("Insert not confirmed");
    return rows[0];
  } catch (e) {
    const recovered = await row(table, id);
    if (recovered) return recovered;
    throw e;
  }
}
module.exports = async function (req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "admin", "parent");
  const path = new URL(req.url, "http://x").pathname,
    body = req.body || {};
  if (req.context.role === "parent" && req.method === "POST" && path === "/") throw new HttpError(403,"RENEWAL_CLOSED","家长自助续费已关闭，请联系管理员录入缴费");
  if (path === "/config") {
    if (req.method === "GET") {
      const { value } = await store.read(CONFIG, { enabled: false });
      ok(res, value);
      return;
    }
    if (req.method === "POST") {
      requireRole(req, res, "admin");
      const value = parse(configSchema, body);
      await store.change(CONFIG, {}, () => value);
      ok(res, value);
      return;
    }
  }
  if (path === "/catalog" && req.method === "GET") {
    const { value: cfg } = await store.read(CONFIG, { enabled: false });
    if (!cfg.enabled) {
      ok(res, []);
      return;
    }
    const { data, error } = await getAdmin()
      .from("package_types")
      .select("id,name,hours,price_cents")
      .eq("active", true)
      .gt("price_cents", 0)
      .order("hours");
    if (error) throw error;
    ok(res, data || []);
    return;
  }
  if (path === "/" && req.method === "GET") {
    const { value: allOrders } = await store.read(ORDERS, []);
    let value=allOrders;
    if(require('../lib/dataScope.js').current()){const {data,error}=await getAdmin().from('students').select('id');if(error)throw error;const ids=new Set((data||[]).map(x=>x.id));value=allOrders.filter(o=>ids.has(o.student_id));}
    ok(
      res,
      value
        .filter((o) => visible(req, o))
        .map(({ proof, qr, ...o }) => o)
        .reverse(),
    );
    return;
  }
  if (path === "/" && req.method === "POST") {
    requireRole(req, res, "parent");
    const v = parse(createSchema, body);
    if (!(await canSeeStudent(req, v.student_id))) {
      notFound(res, "学员不存在");
      return;
    }
    const { value: cfg } = await store.read(CONFIG, { enabled: false });
    if (!cfg.enabled) throw new HttpError(409, "RENEWAL_DISABLED", "自助续费尚未开放");
    const pt = await row("package_types", v.package_type_id),
      student = await row("students", v.student_id);
    if (!student || !pt?.active || !(pt.price_cents > 0))
      throw new HttpError(409, "PACKAGE_UNAVAILABLE", "课时包已下架，请重新选择");
    await store.change(`private/renewals/assets/${v.id}`, null, (a) => a || { qr: cfg.qr });
    const result = await store.change(ORDERS, [], (list) => {
      const old = list.find((x) => x.id === v.id);
      if (old) {
        if (
          old.parent_id !== req.context.userId ||
          old.student_id !== v.student_id ||
          old.package_type_id !== v.package_type_id
        )
          throw new HttpError(409, "ORDER_CHANGED", "订单编号已使用");
        return list;
      }
      if (
        list.some(
          (x) =>
            x.parent_id === req.context.userId &&
            x.student_id === v.student_id &&
            ["pending", "review", "processing"].includes(x.status),
        )
      )
        throw new HttpError(409, "ORDER_EXISTS", "已有待处理续费订单，请先查看订单记录");
      if (list.length >= 2000)
        throw new HttpError(409, "ORDER_CAPACITY", "订单存储已达上限，请联系管理员");
      return [
        ...list,
        {
          ...v,
          parent_id: req.context.userId,
          student_name: student.full_name,
          package_name: pt.name,
          hours: Number(pt.hours),
          amount_cents: pt.price_cents,
          status: "pending",
          created_at: new Date().toISOString(),
          recipient: cfg.recipient,
          instructions: cfg.instructions,
          package_id: randomUUID(),
          payment_id: randomUUID(),
        },
      ];
    });
    ok(res, await getOrder(req, v.id));
    return;
  }
  const match = path.match(/^\/([a-f0-9-]{36})(?:\/(proof|confirm|cancel|reject))?$/i);
  if (!match) {
    notFound(res);
    return;
  }
  const [, id, action] = match;
  if (!action && req.method === "GET") {
    ok(res, await getOrder(req, id));
    return;
  }
  if (req.method !== "POST") {
    notFound(res);
    return;
  }
  await withLock(`renewal-${id}`, async () => {
    let o = await getOrder(req, id);
    if (action === "confirm") {
      requireRole(req, res, "admin");
      await require("../lib/adminConfirmation.js").verify(req, body.current_password);
      if (o.status === "confirmed") {
        ok(res, o);
        return;
      }
      if (!["review", "processing"].includes(o.status))
        throw new HttpError(409, "ORDER_STATE", "请先核对家长提交的付款凭证");
      if (body.amount_cents !== o.amount_cents)
        throw new HttpError(
          400,
          "AMOUNT_MISMATCH",
          "实际到账金额须与订单金额一致，差额请先线下处理",
        );
      const reference = z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{6,80}$/)
        .safeParse(body.payment_reference);
      if (!reference.success)
        throw new HttpError(
          400,
          "PAYMENT_REFERENCE_REQUIRED",
          "请填写微信账单中的交易单号（6至80位字母或数字）",
        );
      if (o.payment_reference && o.payment_reference !== reference.data)
        throw new HttpError(
          409,
          "PAYMENT_REFERENCE_CHANGED",
          "正在处理的订单须使用原交易单号恢复入账",
        );
      o = {
        ...o,
        payment_reference: reference.data,
        status: "processing",
        confirmed_by: o.confirmed_by || req.context.userId,
      };
      const { qr, proof, ...metadata } = o;
      await store.change(ORDERS, [], (list) => {
        if (
          list.some(
            (x) =>
              x.id !== id &&
              x.payment_reference === reference.data &&
              ["processing", "confirmed"].includes(x.status),
          )
        )
          throw new HttpError(409, "PAYMENT_ALREADY_USED", "该微信交易单号已用于另一笔续费订单");
        return list.map((x) => (x.id === id ? metadata : x));
      });
      await ensureRow("student_packages", o.package_id, {
        student_id: o.student_id,
        package_type_id: (await row("package_types", o.package_type_id)) ? o.package_type_id : null,
        total_hours: o.hours,
        remaining_hours: o.hours,
        notes: `续费订单 ${o.id}`,
        expires_at: null,
      });
      await ensureRow("package_payments", o.payment_id, {
        student_package_id: o.package_id,
        student_id: o.student_id,
        amount_cents: o.amount_cents,
        method: "个人微信收款",
        notes: `续费订单 ${o.id} 微信交易 ${o.payment_reference}`,
        recorded_by: o.confirmed_by,
      });
      o = { ...o, status: "confirmed", confirmed_at: new Date().toISOString() };
      await saveOrder(o);
      await require("../lib/audit.js").record(
        req.context.userId,
        "renewal.confirm",
        "student",
        o.student_id,
        { order_id: o.id, amount_cents: o.amount_cents, hours: o.hours, payment_id: o.payment_id },
        req.reqId,
      );
      ok(res, o);
      return;
    }
    if (action === "proof") {
      requireRole(req, res, "parent");
      if (!["pending", "review"].includes(o.status))
        throw new HttpError(409, "ORDER_STATE", "该订单不能提交付款凭证");
      o = {
        ...o,
        ...parse(proofSchema, body),
        status: "review",
        submitted_at: new Date().toISOString(),
      };
    } else if (action === "cancel") {
      if (o.status !== "pending")
        throw new HttpError(409, "ORDER_STATE", "已提交付款或正在入账的订单不能取消");
      o = { ...o, status: "cancelled" };
    } else if (action === "reject") {
      requireRole(req, res, "admin");
      if (o.status !== "review") throw new HttpError(409, "ORDER_STATE", "该订单不能退回");
      const reason = z.string().trim().min(1).max(150).parse(body.reason);
      o = { ...o, status: "pending", review_note: reason };
    } else {
      notFound(res);
      return;
    }
    await saveOrder(o);
    ok(res, o);
  });
};
