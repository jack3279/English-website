const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const { withErrorHandler } = require("../lib/errors.js");
const importRows = withErrorHandler(require("../routes/importRows.js"));

const ADMIN = { id: "admin1", role: "admin" };
const PARENT = { id: "p1", role: "parent" };

const CTX_EMPTY = [
  { data: [], error: null }, // students
  { data: [], error: null }, // teachers
  { data: [], error: null }, // package_types
  { data: [], error: null }, // student_packages
  { data: [], error: null }, // package_payments
  { data: [], error: null }, // profiles(teacher)
];

function stubFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => "[]" };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("students dryrun: 新学员计数 + 存量学员字段合并计数", async () => {
  resetMock();
  setMockResults([
    {
      data: [{ id: "s1", full_name: "小明", status: "active", birth_date: null, notes: null }],
      error: null,
    },
    ...CTX_EMPTY.slice(1),
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: {
      entity: "students",
      dryrun: true,
      rows: [
        { 姓名: "小明", 状态: "停课", 备注: "重点关注" },
        { 姓名: "小红", 出生日期: "2015年5月1日", 英语级别: "A2" },
      ],
    },
    testUser: ADMIN,
  });
  await importRows(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.created, 1);
  assert.equal(captured.body.data.updated, 1);
  assert.equal(captured.body.data.errors.length, 0);
});

test("students commit: 插入新学员 + PATCH 存量 + 写审计", async () => {
  resetMock();
  const f = stubFetch();
  try {
    setMockResults([
      {
        data: [{ id: "s1", full_name: "小明", status: "active", birth_date: null, notes: null }],
        error: null,
      },
      ...CTX_EMPTY.slice(1),
      { data: [{ id: "s2" }], error: null }, // students insert
      { data: null, error: null }, // audit
    ]);
    const { req, res, captured } = applyMiddleware({
      method: "POST",
      url: "/",
      body: {
        entity: "students",
        rows: [{ 姓名: "小明", 状态: "停课" }, { 姓名: "小红" }],
      },
      testUser: ADMIN,
    });
    await importRows(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.created, 1);
    assert.equal(captured.body.data.updated, 1);
    assert.ok(
      f.calls.some((c) => c.url.includes("/students?id=eq.s1") && c.init.method === "PATCH"),
    );
  } finally {
    f.restore();
  }
});

test("payments: 金额元转分、按自然键去重跳过", async () => {
  resetMock();
  setMockResults([
    { data: [{ id: "s1", full_name: "小明" }], error: null },
    { data: [], error: null },
    { data: [{ id: "pt1", name: "60课时包" }], error: null },
    { data: [{ id: "pkg1", student_id: "s1", package_type_id: "pt1" }], error: null },
    // 已有一笔 2026-09-01 ¥3000.00 → 重复
    {
      data: [
        {
          id: "pay1",
          student_id: "s1",
          student_package_id: "pkg1",
          amount_cents: 300000,
          paid_at: "2026-09-01T12:00:00+08:00",
        },
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [{ id: "pay2" }], error: null }, // package_payments insert
    { data: null, error: null }, // audit
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: {
      entity: "payments",
      rows: [
        { 学员姓名: "小明", 课时包名称: "60课时包", 日期: "2026-09-01", 金额: "¥3,000.00" },
        { 学员姓名: "小明", 课时包名称: "60课时包", 日期: "2026-09-10", 金额: 1500 },
      ],
    },
    testUser: ADMIN,
  });
  await importRows(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.created, 1);
  assert.equal(captured.body.data.skipped, 1);
});

test("packages: 学员不存在报错并指引先导入学员", async () => {
  resetMock();
  setMockResults([...CTX_EMPTY]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: {
      entity: "packages",
      dryrun: true,
      rows: [{ 学员姓名: "不存在", 课时包名称: "60课时包", 总课时: 60 }],
    },
    testUser: ADMIN,
  });
  await importRows(req, res);
  assert.equal(captured.statusCode, 200);
  assert.match(captured.body.data.errors[0], /学员不存在/);
});

test("非 admin 导入被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { entity: "students", rows: [{ 姓名: "x" }] },
    testUser: PARENT,
  });
  await importRows(req, res);
  assert.equal(captured.statusCode, 403);
});

test("单次超过 200 行被拒", async () => {
  resetMock();
  const rows = Array.from({ length: 201 }, (_, i) => ({ 姓名: `学员${i}` }));
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: { entity: "students", rows },
    testUser: ADMIN,
  });
  await importRows(req, res);
  assert.equal(captured.statusCode, 400);
});
