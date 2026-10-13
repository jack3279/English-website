const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok, notFound } = require("../lib/http.js");
const { HttpError } = require("../lib/errors.js");
const settings = require("../lib/institutionSettings.js");
const { record: audit } = require("../lib/audit.js");
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  await requireAuth(req, res);
  if (req.method === "GET") {
    ok(res, {
      ...(await settings.getSettings()),
      storageReady: settings.ready(),
      timezone: "Asia/Shanghai",
      billingMinutesPerHour: 60,
    });
    return;
  }
  if (req.method === "PATCH") {
    requireRole(req, res, "admin");
    const checked = settings.Schema.partial().safeParse(req.body);
    if (!checked.success)
      throw new HttpError(400, "BAD_SETTINGS", "请核对机构设置，数值超出允许范围");
    const result = await settings.updateSettings(checked.data);
    await audit(
      req.context.userId,
      "institution.settings_changed",
      "institution",
      null,
      checked.data,
      req.reqId,
    );
    ok(res, {
      ...result,
      storageReady: true,
      timezone: "Asia/Shanghai",
      billingMinutesPerHour: 60,
    });
    return;
  }
  notFound(res);
};
