const { ok, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  await withErrorHandler(req, res);
};

async function withErrorHandler(req, res) {
  try {
    await requireAuth(req, res);
    requireRole(req, res, "admin");

    const url = new URL(req.url, "http://x");
    const limit = Math.min(500, Number(url.searchParams.get("limit") || 100));

    const { data, error } = await getAdmin()
      .from("audit_log")
      .select("id, action, target_type, target_id, actor, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    ok(res, data ?? []);
  } catch (e) {
    if (!res.headersSent) {
      res.status(e.status || 500).json({
        error: e.message || "服务器错误",
        code: e.code || "ERROR",
      });
    }
  }
}