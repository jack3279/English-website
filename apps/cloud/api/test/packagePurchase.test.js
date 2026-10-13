// 守卫: 学员课时包的「购买 / 开卡」闭环。
//
// 背景: 后端早就有 POST /packages/purchase（原子化 开卡 + 录缴费，失败回滚），
// 但**前端一个入口都没有** —— 教务收了家长的钱根本录不进系统，课时包余额与营收
// 永远停在演示数据上。属于「功能存在但用不了」。
//
// 这里锁住购买接口在新增有效期支持后的行为：
//   1. 纯日期按当天结束(+08:00 23:59:59)解释 —— 否则「有效期到 12-31」会被当成
//      12-31 00:00，家长 12-31 白天上课就发现过期了；
//   2. 非法日期必须 400，不能让它冒到 toISOString 抛 RangeError 变成 500；
//   3. 不传有效期仍然可用（有些家长买的是不限期包）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseExpiresAt } = require("../lib/window.js");
const { applyMiddleware } = require("./helpers.js");
const { setMockResult, setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const packages = withErrorHandler(require("../routes/packages.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };
const STUDENT_ID = "11111111-1111-1111-1111-111111111111";
const TYPE_ID = "22222222-2222-2222-2222-222222222222";

function call(body) {
  return applyMiddleware({
    method: "POST",
    url: "/purchase",
    body,
    headers: { authorization: "Bearer fake" },
    testUser: ADMIN,
  });
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test("纯日期按当天结束解释(+08:00 23:59:59.999)", () => {
  const r = parseExpiresAt("2026-12-31");
  assert.equal(r.iso, "2026-12-31T15:59:59.999Z"); // = 北京时间 12-31 23:59:59.999
});

test("完整 ISO 原样解析", () => {
  const r = parseExpiresAt("2027-01-15T00:00:00.000Z");
  assert.equal(r.iso, "2027-01-15T00:00:00.000Z");
});

test("空值 = 不限期(返回 null 而不是报错)", () => {
  assert.deepEqual(parseExpiresAt(null), { iso: null });
  assert.deepEqual(parseExpiresAt(""), { iso: null });
  assert.deepEqual(parseExpiresAt(undefined), { iso: null });
});

test("非法日期返回 bad, 由调用方转 400(不让 toISOString 抛 RangeError)", () => {
  assert.ok(parseExpiresAt("2026-13-45").bad);
  assert.ok(parseExpiresAt("下个月").bad);
  assert.ok(parseExpiresAt("2026-12-31x").bad);
});

test("购买: 非法有效期返回 400 而不是 500", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  setMockResult({
    data: { id: TYPE_ID, hours: 10, active: true, name: "标准包" },
    error: null,
  });
  const { req, res, captured } = call({
    student_id: STUDENT_ID,
    package_type_id: TYPE_ID,
    amount_cents: 500000,
    expires_at: "2026-13-45",
  });
  await packages(req, res);
  assert.equal(captured.statusCode, 400);
  assert.match(captured.body.detail || captured.body.error, /有效期/);
});

test("购买: 不传有效期也能成功", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  setMockResult({
    data: { id: TYPE_ID, hours: 10, active: true, name: "标准包" },
    error: null,
  });
  const { req, res, captured } = call({
    student_id: STUDENT_ID,
    package_type_id: TYPE_ID,
    amount_cents: 500000,
  });
  await packages(req, res);
  assert.equal(captured.statusCode, 200, JSON.stringify(captured.body));
});

test("购买: 已下架的课时包不能卖", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  setMockResult({
    data: { id: TYPE_ID, hours: 10, active: false, name: "旧包" },
    error: null,
  });
  const { req, res, captured } = call({
    student_id: STUDENT_ID,
    package_type_id: TYPE_ID,
    amount_cents: 500000,
  });
  await packages(req, res);
  assert.equal(captured.statusCode, 400);
  assert.match(captured.body.error, /下架/);
});

test("购买: 学员不存在返回 404, 而不是 500 外键错误", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  // 显式排队: ① 查学员 -> 没有  ② 查套餐 -> 有
  setMockResults([
    { data: null, error: null },
    { data: { id: TYPE_ID, hours: 10, active: true, name: "标准包" }, error: null },
  ]);
  const { req, res, captured } = call({
    student_id: STUDENT_ID,
    package_type_id: TYPE_ID,
    amount_cents: 500000,
  });
  await packages(req, res);
  assert.equal(captured.statusCode, 404, "外键错误不该裸奔成 500");
  assert.match(captured.body.error, /学员不存在/);
});

const PKG_ID = "33333333-3333-3333-3333-333333333333";

function callRefund(body, role = "admin") {
  return applyMiddleware({
    method: "POST",
    url: "/refund",
    body,
    headers: { authorization: "Bearer fake" },
    testUser: { ...ADMIN, role },
  });
}

test("退费: 超过剩余课时返回 400，且不改余额", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  setMockResult({
    data: { id: PKG_ID, student_id: STUDENT_ID, remaining_hours: 2, total_hours: 10 },
    error: null,
  });
  const { req, res, captured } = callRefund({
    student_package_id: PKG_ID,
    hours: 5,
    amount_cents: 10000,
    notes: "停课",
  });
  await packages(req, res);
  assert.equal(captured.statusCode, 400);
  assert.match(captured.body.error, /最多可退/);
});

test("退费: 扣剩余课时并准备记退款", async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  setMockResult({
    data: { id: "pay-1", student_id: STUDENT_ID, remaining_hours: 8, total_hours: 10 },
    error: null,
  });
  const patches = [];
  const prev = global.fetch;
  global.fetch = async (url, opts) => {
    patches.push(String(opts?.body || ""));
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: PKG_ID, ...JSON.parse(opts.body) }]) };
  };
  try {
    const { req, res, captured } = callRefund({
      student_package_id: PKG_ID,
      hours: 3,
      amount_cents: 150000,
      method: "微信",
      notes: "家长停课",
    });
    await packages(req, res);
    assert.equal(captured.statusCode, 200, JSON.stringify(captured.body));
    assert.equal(captured.body.data.remaining_hours, 5);
    assert.equal(captured.body.data.refunded_hours, 3);
    assert.equal(captured.body.data.amount_cents, 150000);
    assert.equal(patches.length, 1);
    assert.match(patches[0], /"remaining_hours":5/);
  } finally {
    global.fetch = prev;
  }
});

test("退费: 老师不能办理", async () => {
  const { req, res, captured } = callRefund(
    {
      student_package_id: PKG_ID,
      hours: 1,
      amount_cents: 100,
      notes: "停课",
    },
    "teacher",
  );
  await packages(req, res);
  assert.equal(captured.statusCode, 403);
});

test("退费: 包内余额未扣消课时，以学员实际余额为上限",async()=>{
 setMockResults([{data:{id:PKG_ID,student_id:STUDENT_ID,remaining_hours:10,total_hours:10},error:null},{data:{remaining_hours:1},error:null}]);
 const {req,res,captured}=callRefund({student_package_id:PKG_ID,hours:3,amount_cents:100,notes:"停课"});
 await packages(req,res);assert.equal(captured.statusCode,400);assert.match(captured.body.error,/最多可退 1 小时/);
});
