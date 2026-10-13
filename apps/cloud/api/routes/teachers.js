const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, badRequest, notFound, forbidden } = require("../lib/http.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch, restInsert } = require("../lib/rest.js");
const { z } = require("zod");

// ─────────────────────────────────────────────────────────────
// 两个历史坑, 都在这个文件里收口:
//
// 1) specialties 在库里是 text 列, 历史上混存了两种写法:
//      "ESL, Phonics"          ← seed-users.mjs 写的
//      '["kids","phonics"]'    ← seed-demo-data.sql 用 ::jsonb 塞进 text 得到的
//    直接吐给前端会把引号/方括号渲染成标签内容。统一「存逗号分隔文本, 返回 string[]」。
//
// 2) 课酬有两个字段:
//      teachers.default_rate  历史字段, 单位存疑(元/分混存), 迁移里明确写了"不用于结算"
//      teachers.hourly_pay    语义显式 = 元/小时, /finance/payroll 与 Excel 导入都用它
//    本文件统一用 hourly_pay; default_rate 仅保留为历史数据来源, 不再读写。
//
// 3) profiles 表没有 email 列(邮箱只存在于 auth.users), 之前 select 带上 email 会让
//    整条 profiles 查询 400, 而错误被忽略 → 教师姓名全为空(页面显示 "?")。
// ─────────────────────────────────────────────────────────────

const SPECIALTY_SPLIT = /[,，、]/;

function parseSpecialties(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      // 不是合法 JSON, 退化成按分隔符切
    }
  }
  return s
    .split(SPECIALTY_SPLIT)
    .map((x) => x.trim())
    .filter(Boolean);
}

function serializeSpecialties(v) {
  const list = parseSpecialties(v);
  return list.length ? list.join(", ") : null;
}

const SpecialtiesInput = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .nullable();

const CreateTeacherSchema = z.object({
  profile_id: z.string().uuid(),
  specialties: SpecialtiesInput,
  // 课酬单价(元/小时)
  hourly_pay: z.number().min(0).optional().nullable(),
  // 老师课酬币种(默认 PHP)
  pay_currency: z.string().max(8).optional().nullable(),
  active: z.boolean().optional(),
  // 企业微信成员 UserID (机构内部, 应用消息收件人); 留空表示未绑定
  wecom_user_id: z.string().max(64).optional().nullable(),
});

const UpdateTeacherSchema = CreateTeacherSchema.partial();

function shapeTeacher(row, profile) {
  return {
    id: row.id,
    profile_id: row.profile_id,
    full_name: profile?.full_name ?? "",
    phone: profile?.phone ?? "",
    role: profile?.role ?? "teacher",
    specialties: parseSpecialties(row.specialties),
    hourly_pay: Number(row.hourly_pay ?? 0),
    // 老师课酬币种: 外教按 PHP 结算, 学生收费才是 CNY
    pay_currency: row.pay_currency ?? "PHP",
    active: row.active,
    wecom_user_id: row.wecom_user_id ?? null,
    created_at: row.created_at,
  };
}

async function listTeachers(req, res) {
  // Step 1: list teachers
  let q = getAdmin()
    .from("teachers")
    .select(
      "id, profile_id, specialties, hourly_pay, pay_currency, active, wecom_user_id, created_at",
    );
  if (req.context.role === "teacher") q = q.eq("profile_id", req.context.userId);
  const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  if (!rows || rows.length === 0) {
    ok(res, []);
    return;
  }

  // Step 2: 单独查 profiles (避免 join syntax 问题 + 兼容 schema cache)
  // 注意: profiles 没有 email 列, 不能 select email (会让整条查询 400)
  const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];
  const { data: profs, error: pErr } = await getAdmin()
    .from("profiles")
    .select("id, full_name, role, phone")
    .in("id", profileIds);
  if (pErr) throw pErr;
  const profMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
  const priceConfigs = require("../lib/secureStore.js").ready()
    ? (await require("../lib/payrollPricing.js").config()).teachers
    : {};

  ok(
    res,
    rows.map((r) => {
      const cfg = priceConfigs[r.profile_id];
      return {
        ...shapeTeacher(r, profMap[r.profile_id]),
        ...(cfg
          ? {
              hourly_pay: cfg.hourly_pay,
              pay_currency: cfg.currency,
              settlement_cycle: cfg.cycle,
              pricing_configured: true,
            }
          : {}),
      };
    }),
  );
}

// GET /teachers/candidates —— 「新增教师」下拉用: teacher 角色但还没进 teachers 表的用户
async function listCandidates(req, res) {
  const admin = getAdmin();
  const { data: profs, error } = await admin
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("role", "teacher")
    .order("full_name");
  if (error) throw error;

  const { data: taken, error: tErr } = await admin.from("teachers").select("profile_id");
  if (tErr) throw tErr;
  const takenIds = new Set((taken ?? []).map((r) => r.profile_id));

  ok(
    res,
    (profs ?? [])
      .filter((p) => !takenIds.has(p.id))
      .map((p) => ({ id: p.id, full_name: p.full_name, phone: p.phone, role: p.role })),
  );
}

async function createTeacher(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const parsed = CreateTeacherSchema.safeParse(body);
  if (!parsed.success) {
    badRequest(res, "invalid body", parsed.error.flatten());
    return;
  }

  // 校验 profile 存在 + role=teacher
  const admin = getAdmin();
  const { data: p } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();
  if (!p) {
    badRequest(res, "用户不存在");
    return;
  }
  if (p.role !== "teacher") {
    badRequest(res, "该用户不是 teacher 角色, 不能加入 teachers 表");
    return;
  }

  // 校验唯一: 不能重复 create teachers row for same profile_id
  const { data: exist } = await admin
    .from("teachers")
    .select("id")
    .eq("profile_id", parsed.data.profile_id)
    .maybeSingle();
  if (exist) {
    badRequest(res, "该用户已是教师");
    return;
  }

  const rows = await restInsert("teachers", {
    profile_id: parsed.data.profile_id,
    specialties: serializeSpecialties(parsed.data.specialties),
    hourly_pay: parsed.data.hourly_pay ?? 0,
    pay_currency: parsed.data.pay_currency ?? "PHP",
    active: parsed.data.active ?? true,
    wecom_user_id: parsed.data.wecom_user_id ?? null,
  });
  const data = rows?.[0];
  if (!data) {
    badRequest(res, "创建教师失败");
    return;
  }
  ok(res, shapeTeacher(data, p));
}

async function updateTeacher(req, res, id) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const parsed = UpdateTeacherSchema.safeParse(body);
  if (!parsed.success) {
    badRequest(res, "invalid body", parsed.error.flatten());
    return;
  }

  const patch = {};
  if ("specialties" in parsed.data)
    patch.specialties = serializeSpecialties(parsed.data.specialties);
  if ("hourly_pay" in parsed.data) patch.hourly_pay = parsed.data.hourly_pay ?? 0;
  if ("pay_currency" in parsed.data) patch.pay_currency = parsed.data.pay_currency;
  if ("active" in parsed.data) patch.active = parsed.data.active;
  if ("wecom_user_id" in parsed.data) patch.wecom_user_id = parsed.data.wecom_user_id;
  if (Object.keys(patch).length === 0) {
    badRequest(res, "没有可更新的字段");
    return;
  }

  if (
    ("hourly_pay" in patch || "pay_currency" in patch) &&
    require("../lib/secureStore.js").ready()
  ) {
    const current = await getAdmin().from("teachers").select("*").eq("id", id).maybeSingle();
    if (current.error) throw current.error;
    if (current.data) {
      const pricing = require("../lib/payrollPricing.js");
      const config = await pricing.config();
      const cfg = config.teachers[current.data.profile_id];
      if (cfg) {
        if (
          (patch.hourly_pay !== undefined && patch.hourly_pay !== cfg.hourly_pay) ||
          (patch.pay_currency !== undefined && patch.pay_currency !== cfg.currency)
        ) {
          badRequest(res, "该教师已启用分课程计价，请在教师课酬的价格设置中修改默认价和币种");
          return;
        }
        delete patch.hourly_pay;
        delete patch.pay_currency;
      }
      await pricing.freezeLegacy(current.data);
    }
  }
  const rows = await restPatch("teachers", { id }, patch);
  const data = rows?.[0];
  if (!data) {
    notFound(res, "教师不存在");
    return;
  }
  ok(res, data);
}

async function deleteTeacher(req, res, id) {
  // 软删除: active=false (避免 FK 引用)
  const rows = await restPatch("teachers", { id }, { active: false });
  const data = rows?.[0];
  if (!data) {
    notFound(res, "教师不存在");
    return;
  }
  ok(res, { deleted: true, id: data.id });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");

  await requireAuth(req, res);

  // GET /teachers/candidates —— 必须在 /:id 之前判断, 否则会被当成 id
  //
  // 「还没进 teachers 表的 teacher 角色用户」= 内部人事信息, 只给 admin。
  // 原来只有 requireAuth, 家长也能列出所有未入职的 teacher 账号。
  if (req.method === "GET" && url.pathname === "/candidates") {
    requireRole(req, res, "admin");
    return listCandidates(req, res);
  }

  // GET /teachers (admin/teacher)
  //
  // ⚠️ 原来只有 requireAuth, **任何登录角色（含家长）都能读全体教师名单**,
  // 而响应里带着 hourly_pay / pay_currency —— 那是薪酬数据, 不该让家长看到。
  // 家长端 H5 并不消费这个接口（只用课节里的 profiles.full_name）,
  // 所以直接收紧到 admin/teacher, 不必为家长单独开一个裁剪版。
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
    requireRole(req, res, "admin", "teacher");
    return listTeachers(req, res);
  }

  // POST /teachers (admin only)
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "")) {
    requireRole(req, res, "admin");
    return createTeacher(req, res);
  }

  // PATCH/DELETE /teachers/:id (admin only)
  const m = url.pathname.match(/^\/([^/]+)$/);
  if (m) {
    requireRole(req, res, "admin");
    if (req.method === "PATCH") return updateTeacher(req, res, m[1]);
    if (req.method === "DELETE") return deleteTeacher(req, res, m[1]);
  }

  forbidden(res, "unknown teachers route");
};

// 供单测直接验证归一化规则（历史数据里两种写法都要能吃下）
module.exports.parseSpecialties = parseSpecialties;
module.exports.serializeSpecialties = serializeSpecialties;
