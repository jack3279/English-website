const { withErrorHandler } = require("../lib/errors.js");
const { getDailyLowBalanceReport } = require("../lib/alerts.js");
const { ok, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  await withErrorHandler(async () => {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      const admin = getAdmin();
      const report = await getDailyLowBalanceReport(admin);
      ok(res, report);
      return;
    }
    if (req.method === "GET" && url.pathname === "/low-balance") {
      const admin = getAdmin();
      const { getLowBalanceStudents } = require("../lib/alerts.js");
      const list = await getLowBalanceStudents(admin);
      ok(res, list);
      return;
    }
    if (req.method === "GET" && url.pathname === "/zero-balance") {
      const admin = getAdmin();
      const { getZeroBalanceStudents } = require("../lib/alerts.js");
      const list = await getZeroBalanceStudents(admin);
      ok(res, list);
      return;
    }
    forbidden(res, "unknown alerts route");
  })(req, res);
};
