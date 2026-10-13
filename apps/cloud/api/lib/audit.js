const { getAdmin } = require("./supabase.js");
const { warn } = require("./log.js");

async function record(actor, action, targetType, targetId, payload, reqId) {
  try {
    const { error } = await getAdmin()
      .from("audit_log")
      .insert({
        actor,
        action,
        target_type: targetType,
        target_id: targetId,
        payload: payload ?? null,
        req_id: reqId ?? null,
      });
    if(error) throw error;
  } catch (e) {
    warn("audit_log_insert_failed", { err: e.message, action, targetId });
  }
}

module.exports = { record };
