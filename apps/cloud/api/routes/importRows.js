// POST /admin/import-rows  历史数据 Excel 导入（学员/老师/课时包/缴费）
// 流程：浏览器 xlsx 解析 → POST {entity, rows, dryrun} → 服务端按名称回解 id → 合并/新增
// 免费栈约束：单批 ≤200 行；合并(patch) 每次请求 ≤40 次子请求，超出请分批。
// 老师导入需要建 auth 账号（profiles.id 引用 auth.users），用 @import.local 占位邮箱。
const { ok, badRequest, forbidden } = require("../lib/http.js");
const { requireAuth } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch } = require("../lib/rest.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");

const MAX_ROWS = 200;
const MAX_PATCHES = 40;

const STATUS_STUDENT = {
  在读: "active",
  停课: "inactive",
  休学: "leave",
  结课: "graduated",
  退费: "refunded",
  active: "active",
  inactive: "inactive",
  leave: "leave",
  graduated: "graduated",
  refunded: "refunded",
};
const STATUS_TEACHER = { 正常: true, 停用: false, active: true, inactive: false };
const STATUS_PACKAGE = {
  在读: "active",
  停课: "inactive",
  到期: "expired",
  active: "active",
  inactive: "inactive",
  expired: "expired",
};

// 表头（中文/别名）→ 内部字段
const HEADERS = {
  students: {
    姓名: "full_name",
    学生姓名: "full_name",
    名字: "full_name",
    出生日期: "birth_date",
    生日: "birth_date",
    状态: "status",
    备注: "notes",
    备注说明: "notes",
    英语级别: "level",
    学情分析: "learningStatus",
    学习规划: "studyPlan",
    家长姓名: "parentName",
    家长电话: "parentPhone",
  },
  teachers: {
    姓名: "full_name",
    老师姓名: "full_name",
    邮箱: "email",
    时薪: "hourly_pay",
    课酬: "hourly_pay",
    擅长方向: "specialties",
    擅长: "specialties",
    状态: "status",
    国籍: "nationality",
    电话: "phone",
  },
  packages: {
    学员姓名: "student_name",
    学生姓名: "student_name",
    姓名: "student_name",
    课时包名称: "package_name",
    包名称: "package_name",
    名称: "package_name",
    总课时: "total_hours",
    课时数: "total_hours",
    已用课时: "used_hours",
    已上课时: "used_hours",
    单价: "price",
    价格: "price",
    开始日期: "purchased_at",
    购课日期: "purchased_at",
    到期日: "expires_at",
    状态: "status",
    备注: "notes",
  },
  payments: {
    学员姓名: "student_name",
    学生姓名: "student_name",
    姓名: "student_name",
    课时包名称: "package_name",
    包名称: "package_name",
    日期: "paid_at",
    缴费日期: "paid_at",
    金额: "amount",
    缴费金额: "amount",
    方式: "method",
    收款方式: "method",
    状态: "status",
    备注: "notes",
  },
};

const Input = z.object({
  entity: z.enum(["students", "teachers", "packages", "payments"]),
  dryrun: z.boolean().optional().default(false),
  rows: z.array(z.record(z.string(), z.any())).min(1).max(MAX_ROWS),
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

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v)
    .trim()
    .replace(/[./年月]/g, "-")
    .replace(/日/g, "");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function mapRow(entity, raw) {
  const headers = HEADERS[entity];
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = headers[k];
    if (!field || v === null || v === undefined) continue;
    const val = typeof v === "string" ? v.trim() : v;
    if (val === "") continue;
    out[field] = val;
  }
  return out;
}

async function loadCtx(admin) {
  const [
    { data: students },
    { data: teachers },
    { data: types },
    { data: packages },
    { data: payments },
    { data: profiles },
  ] = await Promise.all([
    admin.from("students").select("id, full_name, status, birth_date, notes").limit(10000),
    admin
      .from("teachers")
      .select("id, profile_id, hourly_pay, specialties, active, profiles!inner(full_name)")
      .limit(5000),
    admin.from("package_types").select("id, name, hours, price_cents").limit(1000),
    admin
      .from("student_packages")
      .select(
        "id, student_id, package_type_id, total_hours, remaining_hours, purchased_at, expires_at, notes",
      )
      .limit(10000),
    admin
      .from("package_payments")
      .select("id, student_id, student_package_id, amount_cents, paid_at")
      .limit(10000),
    admin.from("profiles").select("id, full_name, role").eq("role", "teacher").limit(5000),
  ]);
  const studentNameToId = new Map((students ?? []).map((s) => [String(s.full_name).trim(), s.id]));
  const teacherNameToId = new Map();
  for (const t of teachers ?? []) {
    const name = t.profiles?.full_name;
    if (name)
      teacherNameToId.set(String(name).trim(), { teacher_id: t.id, profile_id: t.profile_id });
  }
  const typeNameToId = new Map((types ?? []).map((t) => [String(t.name).trim(), t.id]));
  const pkgIndex = new Map(); // student_id|type_id -> pkg
  for (const p of packages ?? []) {
    if (p.package_type_id) pkgIndex.set(`${p.student_id}|${p.package_type_id}`, p);
  }
  const paymentKeys = new Set(
    (payments ?? []).map(
      // student_package_id 为 null 时归一为空串 —— 与下面 importPayments 拼 key 的
      // `pkg?.id ?? ""` 保持一致，否则未关联课时包的付款去重失效、被重复导入。
      (p) =>
        `${p.student_id}|${p.student_package_id ?? ""}|${String(p.paid_at).slice(0, 10)}|${p.amount_cents}`,
    ),
  );
  const teacherNames = new Set((profiles ?? []).map((p) => String(p.full_name).trim()));
  return {
    students: students ?? [],
    studentNameToId,
    teacherNameToId,
    typeNameToId,
    pkgIndex,
    paymentKeys,
    teacherNames,
    typeIds: new Set((types ?? []).map((t) => t.id)),
  };
}

async function importStudents(admin, rows, ctx, dryrun, branchId) {
  const toInsert = [];
  const patches = [];
  const errors = [];
  const byName = new Map(ctx.students.map((s) => [String(s.full_name).trim(), s]));

  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const r = mapRow("students", raw);
    if (!r.full_name) return errors.push(`第 ${rowNo} 行缺少必填：姓名`);
    const name = String(r.full_name).trim();
    const status = r.status ? STATUS_STUDENT[r.status] : undefined;
    if (r.status && status === undefined)
      return errors.push(`第 ${rowNo} 行状态不识别：${r.status}`);
    const birth = r.birth_date ? normalizeDate(r.birth_date) : null;
    if (r.birth_date && !birth)
      return errors.push(`第 ${rowNo} 行出生日期格式不识别：${r.birth_date}`);
    const extra = [
      r.level && `级别:${r.level}`,
      r.learningStatus && `学情:${r.learningStatus}`,
      r.studyPlan && `规划:${r.studyPlan}`,
      r.parentName && `家长:${r.parentName} ${r.parentPhone || ""}`,
    ]
      .filter(Boolean)
      .join("；");
    const notes = [r.notes, extra].filter(Boolean).join("；") || null;

    const exist = byName.get(name);
    if (exist) {
      const patch = {};
      if (status && exist.status !== status) patch.status = status;
      if (birth && !exist.birth_date) patch.birth_date = birth;
      if (notes && !exist.notes) patch.notes = notes;
      if (Object.keys(patch).length) patches.push({ id: exist.id, patch });
    } else {
      if (!ctx.studentNameToId.has(name)) {
        toInsert.push({
          full_name: name,
          status: status || "active",
          birth_date: birth,
          notes,
          branch_id: branchId,
        });
        ctx.studentNameToId.set(name, null); // 本批占位防重名
      }
    }
  });

  let created = 0;
  let updated = 0;
  if (!dryrun) {
    if (toInsert.length) {
      const { data, error } = await admin.from("students").insert(toInsert).select("id");
      if (error) throw error;
      created = (data ?? []).length;
    }
    for (const p of patches.slice(0, MAX_PATCHES)) {
      await restPatch("students", { id: p.id }, p.patch);
      updated += 1;
    }
    if (patches.length > MAX_PATCHES) {
      errors.push(`字段合并超过单次上限 ${MAX_PATCHES} 条，请分批导入剩余部分`);
    }
  } else {
    created = toInsert.length;
    updated = Math.min(patches.length, MAX_PATCHES);
  }
  return {
    created,
    updated,
    skipped:
      rows.length -
      toInsert.length -
      patches.length -
      errors.filter((e) => e.startsWith("第")).length,
    errors,
  };
}

async function importTeachers(admin, rows, ctx, dryrun, branchId) {
  const newProfiles = [];
  const patches = [];
  const errors = [];
  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const r = mapRow("teachers", raw);
    if (!r.full_name) return errors.push(`第 ${rowNo} 行缺少必填：姓名`);
    const name = String(r.full_name).trim();
    const rate = r.hourly_pay !== undefined ? toNumber(r.hourly_pay) : null;
    if (r.hourly_pay !== undefined && (rate === null || Number.isNaN(rate))) {
      return errors.push(`第 ${rowNo} 行时薪不是合法数字`);
    }
    const active = r.status !== undefined ? STATUS_TEACHER[r.status] : undefined;
    if (r.status !== undefined && active === undefined)
      return errors.push(`第 ${rowNo} 行状态不识别：${r.status}`);
    const exist = ctx.teacherNameToId.get(name);
    if (exist) {
      const patch = {};
      if (rate !== null) patch.hourly_pay = rate;
      if (r.specialties) patch.specialties = r.specialties;
      if (active !== undefined) patch.active = active;
      if (Object.keys(patch).length) patches.push({ profile_id: exist.profile_id, patch });
    } else if (!ctx.teacherNames.has(name) && !newProfiles.some((p) => p.full_name === name)) {
      newProfiles.push({
        full_name: name,
        email: r.email || null,
        hourly_pay: rate ?? 0,
        specialties: r.specialties || null,
        active: active ?? true,
        phone: r.phone || null,
      });
    }
  });

  let created = 0;
  let updated = 0;
  if (!dryrun) {
    for (const p of newProfiles) {
      const email = p.email || `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@import.local`;
      const { data: userData, error: uErr } = await admin.auth.admin.createUser({
        email,
        password: `Imp!${Math.random().toString(36).slice(2, 12)}`,
        email_confirm: true,
        user_metadata: { full_name: p.full_name, role: "teacher" },
      });
      if (uErr || !userData?.user) {
        errors.push(`老师 ${p.full_name} 创建账号失败：${uErr?.message || "未知"}`);
        continue;
      }
      const { error: pErr } = await admin.from("profiles").insert({
        id: userData.user.id,
        role: "teacher",
        full_name: p.full_name,
        branch_id: branchId, // 与学员导入同口径，绑到操作管理员所在校区
        phone: p.phone || null,
      });
      if (pErr) {
        errors.push(`老师 ${p.full_name} 创建档案失败：${pErr.message}`);
        continue;
      }
      const { error: tErr } = await admin.from("teachers").insert({
        profile_id: userData.user.id,
        hourly_pay: p.hourly_pay,
        specialties: p.specialties,
        active: p.active,
      });
      if (tErr) {
        errors.push(`老师 ${p.full_name} 创建教师记录失败：${tErr.message}`);
        continue;
      }
      created += 1;
    }
    for (const p of patches.slice(0, MAX_PATCHES)) {
      await restPatch("teachers", { profile_id: p.profile_id }, p.patch);
      updated += 1;
    }
    if (patches.length > MAX_PATCHES)
      errors.push(`字段合并超过单次上限 ${MAX_PATCHES} 条，请分批导入`);
  } else {
    created = newProfiles.length;
    updated = Math.min(patches.length, MAX_PATCHES);
  }
  return { created, updated, skipped: rows.length - newProfiles.length - patches.length, errors };
}

async function importPackages(admin, rows, ctx, dryrun) {
  const newTypes = [];
  const toInsert = [];
  const patches = [];
  const errors = [];
  const localTypeNameToId = new Map(ctx.typeNameToId);

  const resolveTypeId = (name, totalHours, price) => {
    if (localTypeNameToId.has(name)) return localTypeNameToId.get(name);
    const id = `new-type:${name}`;
    newTypes.push({
      name,
      hours: totalHours || 1,
      price_cents: price != null ? Math.round(price * 100) : 0,
    });
    localTypeNameToId.set(name, id);
    return id;
  };

  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const r = mapRow("packages", raw);
    if (!r.student_name) return errors.push(`第 ${rowNo} 行缺少必填：学员姓名`);
    if (!r.package_name) return errors.push(`第 ${rowNo} 行缺少必填：课时包名称`);
    const studentId = ctx.studentNameToId.get(String(r.student_name).trim());
    if (!studentId)
      return errors.push(`第 ${rowNo} 行学员不存在：${r.student_name}（请先导入学员）`);
    const total = r.total_hours !== undefined ? toNumber(r.total_hours) : null;
    if (total === null || Number.isNaN(total) || total <= 0)
      return errors.push(`第 ${rowNo} 行总课时不是合法正数`);
    const used = r.used_hours !== undefined ? toNumber(r.used_hours) : 0;
    if (Number.isNaN(used) || used < 0) return errors.push(`第 ${rowNo} 行已用课时不是合法数字`);
    const price = r.price !== undefined ? toNumber(r.price) : null;
    if (price !== null && Number.isNaN(price)) return errors.push(`第 ${rowNo} 行单价不是合法数字`);
    const typeName = String(r.package_name).trim();
    const typeId = resolveTypeId(typeName, total, price);

    const exist = ctx.pkgIndex.get(`${studentId}|${typeId}`);
    if (exist) {
      const patch = {};
      const exp = r.expires_at ? normalizeDate(r.expires_at) : null;
      if (exp && !exist.expires_at) patch.expires_at = exp;
      if (r.notes && !exist.notes) patch.notes = r.notes;
      if (Object.keys(patch).length) patches.push({ id: exist.id, patch });
      // 已有包不动课时数，避免重复导入顶掉余额
    } else {
      toInsert.push({
        student_id: studentId,
        package_type_id: typeId, // 新类型时先插 types 再插 packages
        total_hours: total,
        remaining_hours: Math.max(total - used, 0),
        purchased_at: r.purchased_at
          ? `${normalizeDate(r.purchased_at)}T00:00:00+08:00`
          : new Date().toISOString(),
        expires_at: r.expires_at ? `${normalizeDate(r.expires_at)}T23:59:59+08:00` : null,
        notes: r.notes || null,
      });
    }
  });

  let created = 0;
  let updated = 0;
  if (!dryrun) {
    for (const t of newTypes) {
      const { data, error } = await admin
        .from("package_types")
        .insert(t)
        .select("id")
        .maybeSingle();
      if (error) {
        errors.push(`课时包类型 ${t.name} 创建失败：${error.message}`);
        continue;
      }
      for (const p of toInsert)
        if (p.package_type_id === `new-type:${t.name}`) p.package_type_id = data.id;
    }
    const { data, error } = await admin.from("student_packages").insert(toInsert).select("id");
    if (error) throw error;
    created = (data ?? []).length;
    for (const p of patches.slice(0, MAX_PATCHES)) {
      await restPatch("student_packages", { id: p.id }, p.patch);
      updated += 1;
    }
    if (patches.length > MAX_PATCHES)
      errors.push(`字段合并超过单次上限 ${MAX_PATCHES} 条，请分批导入`);
  } else {
    created = toInsert.length;
    updated = Math.min(patches.length, MAX_PATCHES);
  }
  return {
    created,
    updated,
    skipped:
      rows.length -
      toInsert.length -
      patches.length -
      errors.filter((e) => e.startsWith("第")).length,
    errors,
  };
}

async function importPayments(admin, rows, ctx, dryrun, _branchId, adminId) {
  const toInsert = [];
  const errors = [];
  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const r = mapRow("payments", raw);
    if (!r.student_name) return errors.push(`第 ${rowNo} 行缺少必填：学员姓名`);
    if (r.amount === undefined) return errors.push(`第 ${rowNo} 行缺少必填：金额`);
    if (r.status && !["已付", "付清", "paid"].includes(r.status))
      return errors.push(`第 ${rowNo} 行状态非已付，历史导入仅支持已付（${r.status}）`);
    const studentId = ctx.studentNameToId.get(String(r.student_name).trim());
    if (!studentId) return errors.push(`第 ${rowNo} 行学员不存在：${r.student_name}`);
    const amount = toNumber(r.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0)
      return errors.push(`第 ${rowNo} 行金额不是合法正数`);
    const typeName = r.package_name ? String(r.package_name).trim() : "";
    const typeId = typeName ? ctx.typeNameToId.get(typeName) : null;
    const pkg = typeId ? ctx.pkgIndex.get(`${studentId}|${typeId}`) : null;
    const paidDay = r.paid_at ? normalizeDate(r.paid_at) : new Date().toISOString().slice(0, 10);
    const key = `${studentId}|${pkg?.id ?? ""}|${paidDay}|${Math.round(amount * 100)}`;
    if (ctx.paymentKeys.has(key)) return; // 已存在，跳过
    ctx.paymentKeys.add(key);
    toInsert.push({
      student_id: studentId,
      student_package_id: pkg?.id ?? null,
      amount_cents: Math.round(amount * 100),
      method: r.method || null,
      paid_at: `${paidDay}T12:00:00+08:00`,
      recorded_by: adminId,
      notes: r.notes || null,
    });
  });

  let created = 0;
  if (!dryrun) {
    if (toInsert.length) {
      const { data, error } = await admin.from("package_payments").insert(toInsert).select("id");
      if (error) throw error;
      created = (data ?? []).length;
    }
  } else {
    created = toInsert.length;
  }
  return {
    created,
    updated: 0,
    skipped: rows.length - toInsert.length - errors.filter((e) => e.startsWith("第")).length,
    errors,
  };
}

const HANDLERS = {
  students: importStudents,
  teachers: importTeachers,
  packages: importPackages,
  payments: importPayments,
};

module.exports = async function handler(req, res) {
  await requireAuth(req, res);
  if (req.context.role !== "admin") {
    forbidden(res, "只有 admin 可以导入数据");
    return;
  }
  if (req.method !== "POST") {
    forbidden(res, "method not allowed");
    return;
  }
  const parsed = Input.safeParse(body(req));
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const { entity, rows, dryrun } = parsed.data;
  const admin = getAdmin();
  const ctx = await loadCtx(admin);
  const fn = HANDLERS[entity];
  // 第 5 参 = branchId（学员/老师绑校区用）；第 6 参 = adminId（缴费 recorded_by 用）。
  // 原先只传 userId，学员导入会把 branch_id 误设成管理员个人 uuid，外键无效导致整批失败。
  const result = await fn(admin, rows, ctx, dryrun, req.context.branchId, req.context.userId);

  if (!dryrun) {
    await audit(
      req.context.userId,
      "import.rows",
      entity,
      null,
      {
        entity,
        rows: rows.length,
        created: result.created,
        updated: result.updated,
        errors: result.errors.length,
      },
      req.reqId,
    );
  }

  ok(res, { entity, dryrun, ...result });
};
