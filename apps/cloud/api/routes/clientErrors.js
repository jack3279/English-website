const { ok, badRequest } = require("../lib/http.js");
const { optionalAuth } = require("../lib/auth.js");
const { record: audit } = require("../lib/audit.js");
const { z } = require("zod");

const ClientErrorInput = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(5000).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
});

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    badRequest(res, "POST only");
    return;
  }
  const parsed = ClientErrorInput.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "参数不合法", parsed.error.flatten());
    return;
  }
  const e = parsed.data;
  await optionalAuth(req, res);
  await audit(
    req.context?.userId ?? null,
    "client.error",
    null,
    null,
    {
      message: e.message,
      stack: e.stack,
      url: e.url,
      userAgent: e.userAgent,
    },
    req.reqId,
  );
  ok(res, { recorded: true });
};
