const store = require("./secureStore.js");
const { HttpError } = require("./errors.js");
async function executeFinancialRequest({ actor, operation, key, body, run }) {
  if (!store.ready())
    throw new HttpError(503, "FINANCIAL_GUARD_UNAVAILABLE", "防重复提交存储暂不可用，请稍后再录入");
  const name = `private/financial-requests/${actor}/${operation}/${key}`;
  const fingerprint = await store.hash(JSON.stringify(body));
  async function existing() {
    const { value } = await store.read(name, null);
    if (!value) return null;
    if (value.fingerprint !== fingerprint)
      throw new HttpError(409, "FINANCIAL_REQUEST_CHANGED", "提交内容已经改变，请重新核对这笔业务");
    if (value.state === "done") return value.result;
    throw new HttpError(
      409,
      "FINANCIAL_RESULT_UNKNOWN",
      "该笔提交正在处理或结果未确认，请先核对课时及收款记录，不要重复录入",
    );
  }
  const cached = await existing();
  if (cached) return cached;
  const owner = store.randomId();
  const lock = await store.change(name, null, (current) =>
    current ? null : { state: "pending", fingerprint, owner, createdAt: new Date().toISOString() },
  );
  if (!lock) {
    const result = await existing();
    if (result) return result;
    throw new HttpError(409, "FINANCIAL_RESULT_UNKNOWN", "提交状态未能确认，请先核对记录");
  }
  let result;
  try {
    result = await run();
  } catch {
    throw new HttpError(
      503,
      "FINANCIAL_RESULT_UNKNOWN",
      "这笔业务结果未能确认，请先核对课时和收款记录，再联系教务处理",
    );
  }
  if (!result || result.status >= 500)
    throw new HttpError(
      503,
      "FINANCIAL_RESULT_UNKNOWN",
      "这笔业务可能未完成，请先核对课时和收款记录，不要重复录入",
    );
  try {
    const saved = await store.change(name, null, (current) =>
      current?.owner === owner ? { ...current, state: "done", result } : null,
    );
    if (!saved) throw new Error("Financial result ownership changed");
  } catch {
    throw new HttpError(
      503,
      "FINANCIAL_RESULT_UNKNOWN",
      "业务提交已执行，但防重结果未能保存，请先核对记录，不要再次录入",
    );
  }
  return result;
}
module.exports = { executeFinancialRequest };
