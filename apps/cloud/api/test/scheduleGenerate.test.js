const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const { withErrorHandler } = require("../lib/errors.js");
const schedules = withErrorHandler(require("../routes/schedules.js"));

const ADMIN = { id: "admin1", role: "admin" };
const C1 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
// 2026-09-18 是周五
const COURSE = {
  id: C1,
  teacher_id: "t1",
  student_id: "s1",
  weekday: 5,
  start_time: "18:00:00",
  duration_min: 60,
  active: true,
  recurrence: "weekly",
  start_date: null,
  end_date: null,
  meeting_url: "https://meeting/123",
};

test("POST /schedules/generate 展开 weekly 模板生成课节", async () => {
  resetMock();
  setMockResults([
    { data: [COURSE], error: null }, // courses
    { data: [], error: null }, // 区间内已有课节
    { data: [{ id: "n1" }, { id: "n2" }], error: null }, // insert
    { data: null, error: null }, // audit
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/generate",
    body: { from: "2026-09-18", to: "2026-09-25" },
    testUser: ADMIN,
  });
  await schedules(req, res);

  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.created, 2);
  assert.equal(captured.body.data.skipped_conflict, 0);
});

test("generate 是幂等的: 已存在的 (course, 日期) 跳过", async () => {
  resetMock();
  setMockResults([
    { data: [COURSE], error: null },
    {
      // 09-18 18:00 (+08) 已生成过
      data: [
        {
          id: "old1",
          course_id: C1,
          teacher_id: "t1",
          student_id: "s1",
          scheduled_at: "2026-09-18T18:00:00+08:00",
          duration_min: 60,
          status: "scheduled",
        },
      ],
      error: null,
    },
    { data: [{ id: "n2" }], error: null },
    { data: null, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/generate",
    body: { from: "2026-09-18", to: "2026-09-25" },
    testUser: ADMIN,
  });
  await schedules(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.created, 1); // 只补 09-25
});

test("generate 冲突的课节跳过并汇报", async () => {
  resetMock();
  setMockResults([
    { data: [COURSE], error: null },
    {
      // 老师在 09-18 18:30 已有别的课, 与新课节 18:00-19:00 重叠
      data: [
        {
          id: "busy",
          course_id: "c-other",
          teacher_id: "t1",
          student_id: "s2",
          scheduled_at: "2026-09-18T18:30:00+08:00",
          duration_min: 60,
          status: "scheduled",
        },
      ],
      error: null,
    },
    { data: [{ id: "n2" }], error: null },
    { data: null, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/generate",
    body: { from: "2026-09-18", to: "2026-09-25" },
    testUser: ADMIN,
  });
  await schedules(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.created, 1);
  assert.equal(captured.body.data.skipped_conflict, 1);
  assert.equal(captured.body.data.conflicts[0].type, "teacher");
});

test("generate 超 62 天被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/generate",
    body: { from: "2026-09-18", to: "2026-12-31" },
    testUser: ADMIN,
  });
  await schedules(req, res);
  assert.equal(captured.statusCode, 400);
});

test("generate 非 admin 被拒", async () => {
  resetMock();
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/generate",
    body: { from: "2026-09-18", to: "2026-09-25" },
    testUser: { id: "p1", role: "parent" },
  });
  await schedules(req, res);
  assert.equal(captured.statusCode, 403);
});
