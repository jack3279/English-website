const { requireAuth } = require("../lib/auth.js");
const { ok } = require("../lib/http.js");
const { getAdmin } = require("../lib/supabase.js");

module.exports = async function handler(req, res) {
  await requireAuth(req, res);
  const { data, error } = await getAdmin().from("branches").select("id, name, code").order("name");
  if (error) throw error;
  ok(res, data ?? []);
};
