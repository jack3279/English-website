// GET /me/renewal —— 课时预警，家长端与每日续费提醒共用同一判定口径 (pickRenewalAlerts)。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const me = withErrorHandler(require("../routes/me.js"));

const PARENT = { id: "00000000-0000-0000-0000-0000000000p1", role: "parent", full_name: "张妈妈" };
const ADMIN = { id: "00000000-0000-0000-0000-000000000099", role: "admin", full_name: "Admin" };

function pack(over = {}) {
  return {
    id: "sp1",
    student_id: "s1",
    total_hours: 20,
    remaining_hours: 2,
    expires_at: null,
    package_types: { name: "20课时" },
    students: { full_name: "小明", status: "active" },
    ...over,
  };
}

test.afterEach(() => resetMock());

test("家长看到自己孩子的课时预警", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: "s1" }], error: null }, // 该家长的可见学员
    { data: [pack()], error: null }, // student_packages
    {data:[{student_id:"s1",remaining_hours:2}],error:null},
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/renewal",
    testUser: PARENT,
  });
  await me(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.items.length, 1);
  const item = captured.body.data.items[0];
  assert.equal(item.stage, "low");
  assert.equal(item.student_name, "小明");
  assert.equal(item.package_name, "20课时");
  assert.equal(item.remaining_hours, 2);
});

test("家长没有孩子时直接返回空, 不再查课时包", async () => {
  resetMock();
  setMockResults([{ data: [], error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/renewal",
    testUser: PARENT,
  });
  await me(req, res);
  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.body.data.items, []);
});

test("管理员不限范围 (不查可见性)", async () => {
  resetMock();
  setMockResults([
    {
      data: [
        pack({ id: "sp1", student_id: "s1" }),
        pack({
          id: "sp2",
          student_id: "s2",
          total_hours: 20,
          remaining_hours: 18,
          expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
          students: { full_name: "小红", status: "active" },
        }),
        pack({
          id: "sp3",
          student_id: "s3",
          remaining_hours: 15,
          total_hours: 20,
          students: { full_name: "小刚", status: "active" },
        }),
      ],
      error: null,
    },
    {data:[{student_id:"s1",remaining_hours:2},{student_id:"s2",remaining_hours:18},{student_id:"s3",remaining_hours:15}],error:null},
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/renewal",
    testUser: ADMIN,
  });
  await me(req, res);
  assert.equal(captured.statusCode, 200);
  const stages = captured.body.data.items.map((i) => `${i.package_id}:${i.stage}`).sort();
  assert.deepEqual(stages, ["sp1:low", "sp2:expiring"]);
});

test("停课学员不提示续费", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: "s1" }], error: null },
    { data: [pack({ students: { full_name: "小明", status: "inactive" } })], error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/renewal",
    testUser: PARENT,
  });
  await me(req, res);
  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.body.data.items, []);
});

test("非 /renewal 路径仍返回个人资料", async () => {
  resetMock();
  setMockResults([{ data: { name: "总校" }, error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: "/",
    testUser: { ...PARENT, branch_id: "b-1" },
  });
  await me(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.role, "parent");
  assert.equal(captured.body.data.branch_name, "总校");
});
