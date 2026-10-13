const test = require("node:test"),
  assert = require("node:assert/strict");
const { executeFinancialRequest: execute } = require("../lib/financialRequests.js");
class Bucket {
  constructor() {
    this.files = new Map();
    this.version = 0;
    this.failDone = false;
  }
  async get(key) {
    const row = this.files.get(key);
    return row ? { etag: row.etag, json: async () => JSON.parse(row.data) } : null;
  }
  async put(key, data, options) {
    if (this.failDone && this.version > 0) throw new Error("storage down");
    const row = this.files.get(key);
    if (options?.onlyIf?.etagMatches && row?.etag !== options.onlyIf.etagMatches) return null;
    if (options?.onlyIf?.get?.("If-None-Match") === "*" && row) return null;
    const saved = { data, etag: String(++this.version) };
    this.files.set(key, saved);
    return saved;
  }
}
let bucket;
test.beforeEach(() => {
  bucket = new Bucket();
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: bucket,
    PUSHPLUS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
  };
});
test.afterEach(() => delete globalThis.__CLOUDFLARE_ENV);
const args = { actor: "admin", operation: "purchase", key: "request-1", body: { amount: 100 } };
const result = { status: 200, body: { data: { id: "payment-1" } } };
test("同一缴费编号重复请求只执行一次且返回原结果", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
    return result;
  };
  assert.deepEqual(await execute({ ...args, run }), result);
  assert.deepEqual(await execute({ ...args, run }), result);
  assert.equal(calls, 1);
  assert(![...bucket.files.values()][0].data.includes("payment-1"), "记录应加密保存");
});
test("并发重复请求只有一个记账执行者", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return result;
  };
  const responses = await Promise.allSettled([
    execute({ ...args, run }),
    execute({ ...args, run }),
  ]);
  assert.equal(calls, 1);
  assert.equal(responses.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    responses.find((r) => r.status === "rejected").reason.code,
    "FINANCIAL_RESULT_UNKNOWN",
  );
});
test("同一编号更改金额必须拒绝", async () => {
  await execute({ ...args, run: async () => result });
  await assert.rejects(
    execute({ ...args, body: { amount: 200 }, run: () => assert.fail("不得再执行") }),
    { code: "FINANCIAL_REQUEST_CHANGED" },
  );
});
test("记账异常后重试不能重复执行", async () => {
  let calls = 0;
  const run = async () => {
    calls++;
    throw new Error("connection lost");
  };
  await assert.rejects(execute({ ...args, run }), { code: "FINANCIAL_RESULT_UNKNOWN" });
  await assert.rejects(execute({ ...args, run }), { code: "FINANCIAL_RESULT_UNKNOWN" });
  assert.equal(calls, 1);
});
test("已执行但结果保存失败时要求核对，重试不再记账", async () => {
  const run = async () => {
    bucket.failDone = true;
    return result;
  };
  await assert.rejects(execute({ ...args, run }), { code: "FINANCIAL_RESULT_UNKNOWN" });
  await assert.rejects(execute({ ...args, run: () => assert.fail("不得再执行") }), {
    code: "FINANCIAL_RESULT_UNKNOWN",
  });
});
test("防重存储不可用时阻止提交", async () => {
  delete globalThis.__CLOUDFLARE_ENV;
  await assert.rejects(execute({ ...args, run: () => assert.fail("不得执行") }), {
    code: "FINANCIAL_GUARD_UNAVAILABLE",
  });
});
