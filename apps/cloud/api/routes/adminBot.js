const { z } = require("zod");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, notFound } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const assistants = require("../lib/adminBot.js");
const { record: audit } = require("../lib/audit.js");
const Settings = z
  .object({
    apiKey: z
      .string()
      .trim()
      .max(256)
      .refine((v) => !v || /^\S{16,256}$/.test(v))
      .optional()
      .default(""),
    current_password: z.string().max(128).optional().default(""),
    consent: z.boolean(),
    includeNames: z.boolean().default(false),
    enabled: z.boolean(),
    budgetYuan: z.number().int().min(1).max(100),
    dailyLimit: z.number().int().min(1).max(50),
    reminders: z.boolean(),
    lessonReminders: z.boolean().optional(),
    lessonReminderMinutes: z.number().int().min(1).max(180).optional(),
    reminderTimes: z
      .array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(4)
      .transform((v) => [...new Set(v)]),
  })
  .strict();
function parse(schema, body) {
  const checked = schema.safeParse(body);
  if (!checked.success) throw new HttpError(400, "BOT_INVALID_INPUT", "请核对机器人设置或提问内容");
  return checked.data;
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  await requireAuth(req, res);
  requireRole(req, res, "admin");
  const path = new URL(req.url, "http://x").pathname,
    actor = req.context.userId;
  const bot = await assistants.forUser(actor);
  const state = await bot.state();
  bot.owner(state, actor);
  if (path === "/snapshot" && req.method === "GET") {
    ok(res, await require("../lib/adminBotData.js").snapshot(state.includeNames));
    return;
  }
  if (path === "/settings" && req.method === "GET") {
    ok(res, bot.view(state, actor));
    return;
  }
  if (path === "/settings" && req.method === "PATCH") {
    const input = parse(Settings, req.body);
    const value = await bot.save(req, input);
    await audit(
      actor,
      "admin_bot.settings_changed",
      "admin_bot",
      null,
      {
        enabled: input.enabled,
        consent: input.consent,
        includeNames: input.includeNames,
        budgetYuan: input.budgetYuan,
      },
      req.reqId,
    );
    ok(res, bot.view(value, actor));
    return;
  }
  if (path === "/wechat/qr" && req.method === "POST") {
    ok(res, await bot.makeQr(req));
    return;
  }
  if (path === "/wechat/state" && req.method === "POST") {
    const input = parse(
      z
        .object({
          pairId: z.string().regex(/^[a-f0-9]{64}$/),
          verification: z
            .string()
            .regex(/^\d{4,12}$/)
            .optional(),
        })
        .strict(),
      req.body,
    );
    ok(res, await bot.checkQr(req, input.pairId, input.verification));
    return;
  }
  if (path === "/ask" && req.method === "POST") {
    const input = parse(
      z
        .object({
          question: z.string().trim().min(1).max(1000),
          idempotency_key: z.string().uuid(),
        })
        .strict(),
      req.body,
    );
    const lease = await bot.lock();
    if (!lease) throw new HttpError(429, "BOT_BUSY", "机器人正在处理消息，请稍后再试");
    try {
      ok(res, {
        reply: await bot.answer(input.idempotency_key, input.question),
        ...(await bot.state()).runtime.usage,
      });
    } finally {
      await bot.unlock(lease);
    }
    return;
  }
  if (path === "/sync" && req.method === "POST") {
    ok(res, await bot.tick());
    return;
  }
  if (path === "/pause" && req.method === "POST") {
    const value = await bot.change((c) => ({ ...c, enabled: false, version: c.version + 1 }));
    ok(res, bot.view(value, actor));
    return;
  }
  if (path === "/history/clear" && req.method === "POST") {
    await bot.change((c) => ({ ...c, runtime: { ...c.runtime, history: [] } }));
    ok(res, { cleared: true });
    return;
  }
  notFound(res);
};
