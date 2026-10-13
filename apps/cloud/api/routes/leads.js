const { ok, badRequest, notFound, forbidden, checkEnumParam } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { restPatch } = require("../lib/rest.js");
const notify = require("../lib/notify.js");
const { error: logError } = require("../lib/log.js");
const { z } = require("zod");

const PHONE_CN_RE = /^1[3-9]\d{9}$/;

// 期望试听日期：只认 YYYY-MM-DD，且不能是过去的日子。
// 放宽到「今天」而不强制明天之后 —— 教务现场补录当天来访的家长是正常操作。
const TODAY_SHANGHAI = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const trialDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "试听日期格式应为 YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "试听日期不是有效日期")
  .refine((v) => v >= TODAY_SHANGHAI(), "试听日期不能早于今天")
  .nullable()
  .optional();

const createSchema = z.object({
  parent_name: z.string().min(1).max(80),
  parent_phone: z.string().regex(PHONE_CN_RE, "请填写有效的 11 位中国大陆手机号"),
  child_name: z.string().max(80).optional().nullable(),
  child_age: z.number().int().min(2).max(18).optional().nullable(),
  preferred_time: z.string().max(80).optional().nullable(),
  intended_course: z.string().max(80).optional().nullable(),
  trial_date: trialDateSchema,
  notes: z.string().max(500).optional().nullable(),
});

const updateSchema = z.object({
  status: z.enum(["new", "contacted", "trial_scheduled", "converted", "lost"]).optional(),
  notes: z.string().max(500).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  intended_course: z.string().max(80).optional().nullable(),
  // 教务回电后补填试听日期是常见场景，允许 PATCH 写入；
  // 但**不复用** trialDateSchema 的「不能早于今天」约束 —— 补录历史记录时要放行。
  trial_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "试听日期格式应为 YYYY-MM-DD")
    .nullable()
    .optional(),
});

function getAdminClient() {
  return getAdmin();
}

// v6 迁移（20260921000003）给 leads 加了 intended_course / trial_date 两列。
// 部署顺序本应是「先迁移、后部署」，但公开招生页是外部入口：万一 SQL 还没跑、代码先上了，
// 报错会让整张报名表单 500 —— 比少收集两个可选字段严重得多。
// 所以遇到「列不存在」时降级重试：报名照样成功，只是这两个字段留空。
const TRIAL_FIELDS = ["intended_course", "trial_date"];

function isMissingTrialColumn(e) {
  const msg = [e && e.message, e && e.details, e && e.hint, e && e.code].filter(Boolean).join(" ");
  return /trial_date|intended_course/.test(msg) && /column|42703|schema cache/i.test(msg);
}

function withoutTrialFields(obj) {
  const copy = { ...obj };
  for (const k of TRIAL_FIELDS) delete copy[k];
  return copy;
}

const BASE_SELECT =
  "id, parent_name, parent_phone, child_name, child_age, preferred_time, notes, status, created_at, updated_at, assigned_to";
const FULL_SELECT = `${BASE_SELECT}, ${TRIAL_FIELDS.join(", ")}`;

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const admin = getAdmin();

  // POST /leads  (public: 公开招生表单)
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "")) {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    const payload = { ...parsed.data, status: "new" };
    let result = await admin
      .from("leads")
      .insert(payload)
      .select("id, status, created_at")
      .maybeSingle();
    if (result.error && isMissingTrialColumn(result.error)) {
      // 迁移未执行：丢掉新增字段重写一次，保证报名不中断
      result = await admin
        .from("leads")
        .insert(withoutTrialFields(payload))
        .select("id, status, created_at")
        .maybeSingle();
    }
    if (result.error) throw result.error;
    const data = result.data;

    // 通知管理员: 有人报名试听。否则除非主动翻线索列表, 没人知道来了新线索。
    // 插一条 target_role='admin' 即可广播给全部管理员, 不用一人一条。
    const who = [
      `${parsed.data.parent_name}（${parsed.data.parent_phone}）`,
      parsed.data.child_name ? `为孩子 ${parsed.data.child_name}` : "",
      parsed.data.child_age ? `${parsed.data.child_age} 岁` : "",
    ]
      .filter(Boolean)
      .join(" ");
    // 通知正文带上课程与日期，管理员不用点进详情就知道该怎么安排回电
    const detail = [
      parsed.data.intended_course ? `意向 ${parsed.data.intended_course}` : "",
      parsed.data.trial_date ? `期望 ${parsed.data.trial_date} 试听` : "",
      parsed.data.preferred_time ? `方便联系：${parsed.data.preferred_time}` : "",
    ].filter(Boolean);
    await notify.push(
      {
        type: "lead",
        title: "有新的试听报名",
        body: `${who} 提交了试听申请${detail.length ? `，${detail.join("，")}` : ""}`,
        target_role: "admin",
        link: "/admin/leads",
      },
      { reqId: req.reqId, source: "leads.create", leadId: data.id },
    );

    ok(res, { id: data.id, status: data.status, message: "报名成功, 我们会尽快联系您" });
    return;
  }

  // 以下需要登录
  await requireAuth(req, res);
  // 招生线索 = **admin only**。
  // 之前这里放行了 teacher，理由大概是「老师也要跟进试听」。但：
  //   1) GET 没有任何 assigned_to 过滤 → 老师会拿到**全部**线索，
  //      含别的老师正在跟进的家长手机号（个人信息）；
  //   2) 前端 /admin/leads 与侧边栏入口早已收紧为 admin，GET /operations
  //      也刻意不给老师 new_lead 分组 —— 三方口径本来就该是 admin。
  // 「老师打不了管理页 UI」不是安全边界：拿到 token 就能直接调接口。
  // 真要老师参与跟进，得先在 GET 里按 assigned_to 过滤，而不是整表放行。
  requireRole(req, res, "admin");
  const conversion = url.pathname.match(/^\/([0-9a-f-]+)\/convert$/);
  if (req.method === "POST" && conversion) {
    ok(res, await require("../lib/leadConversion.js").convert(req, conversion[1], req.body));
    return;
  }

  // GET /leads
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
    const status = url.searchParams.get("status");
    // leads.status 是 lead_status enum, 非法值会被 PostgREST 打成 500。
    if (
      !checkEnumParam(res, "status", status, [
        "new",
        "contacted",
        "trial_scheduled",
        "converted",
        "lost",
      ])
    ) {
      return;
    }
    try {
      const build = (select) => {
        let q = admin
          .from("leads")
          .select(select)
          .order("created_at", { ascending: false })
          .limit(200);
        if (status) q = q.eq("status", status);
        return q;
      };
      let result = await build(FULL_SELECT);
      if (result.error && isMissingTrialColumn(result.error)) {
        // 同上：迁移没跑就退回旧字段集，线索列表照常可用
        result = await build(BASE_SELECT);
      }
      if (result.error) throw result.error;
      const conversions = await require("../lib/leadConversion.js").mapping();
      ok(
        res,
        (result.data ?? []).map((lead) => ({
          ...lead,
          converted_student_id:
            conversions[lead.id]?.state === "done" ? conversions[lead.id].student_id : null,
          conversion_pending_student_id:
            conversions[lead.id]?.state === "pending" && conversions[lead.id].studentCreated
              ? conversions[lead.id].student_id
              : null,
          conversion_draft:
            conversions[lead.id]?.state === "pending" ? conversions[lead.id].details : null,
        })),
      );
    } catch (e) {
      // 走 lib/log.js 的结构化日志: 裸 console 没有 reqId,
      // 出问题时没法跟响应头里的 x-request-id 对上。
      logError("leads_list_failed", {
        reqId: req.reqId,
        err: e?.message,
        code: e?.code,
        details: e?.details,
      });
      throw e;
    }
    return;
  }

  // PATCH /leads/:id
  const m = url.pathname.match(/^\/([^/]+)$/);
  if (req.method === "PATCH" && m) {
    const id = m[1];
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      badRequest(res, "invalid body", parsed.error.flatten());
      return;
    }
    let rows;
    try {
      rows = await restPatch("leads", { id }, parsed.data);
    } catch (e) {
      if (!isMissingTrialColumn(e) || !TRIAL_FIELDS.some((k) => k in parsed.data)) throw e;
      // 迁移未执行：只保留旧字段再写一次
      rows = await restPatch("leads", { id }, withoutTrialFields(parsed.data));
    }
    const data = rows?.[0];
    if (!data) {
      notFound(res, "lead not found");
      return;
    }
    ok(res, data);
    return;
  }

  forbidden(res, "unknown leads route");
};
