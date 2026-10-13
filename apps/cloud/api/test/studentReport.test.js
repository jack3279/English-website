const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";

const handler = require("../routes/students.js");
const ID = "22222222-2222-2222-2222-222222222222";

const LESSONS = [
  {
    id: "l1",
    scheduled_at: "2026-09-01T10:00:00Z",
    status: "completed",
    duration_min: 60,
    leave_status: null,
    teacher_id: "t1",
    records: { id: "r1", performance: "excellent" },
  },
  {
    id: "l2",
    scheduled_at: "2026-09-08T10:00:00Z",
    status: "completed",
    duration_min: 60,
    leave_status: null,
    teacher_id: "t1",
    records: [],
  },
  {
    id: "l3",
    scheduled_at: "2026-09-15T10:00:00Z",
    status: "no_show",
    duration_min: 60,
    leave_status: null,
    teacher_id: "t1",
    records: [],
  },
  {
    id: "l4",
    scheduled_at: "2026-09-22T10:00:00Z",
    status: "scheduled",
    duration_min: 60,
    leave_status: "approved",
    teacher_id: "t1",
    records: [],
  },
  {
    id: "l5",
    scheduled_at: "2026-09-29T10:00:00Z",
    status: "cancelled",
    duration_min: 60,
    leave_status: null,
    teacher_id: "t1",
    records: [],
  },
];

test("GET /students/:id/report 计算上课次数/课时/出勤率/缺勤/请假", async () => {
  resetMock();
  setMockResults([
    { data: LESSONS, error: null },
    { data: [{ id: "t1", full_name: "Alice" }], error: null },
    { data: { remaining_hours: 12.5 }, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: `/${ID}/report`,
    testUser: { id: "admin1", role: "admin" },
  });
  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  const { metrics, items } = captured.body.data;
  // planned = 排除 cancelled = 4 节
  assert.equal(metrics.planned, 4);
  assert.equal(metrics.completed, 2);
  assert.equal(metrics.cancelled, 1);
  assert.equal(metrics.no_show, 1);
  assert.equal(metrics.leave_approved, 1);
  assert.equal(metrics.hours, 2);
  assert.equal(metrics.attendance_rate, 50);
  assert.equal(metrics.remaining_hours, 12.5);
  assert.equal(items.length, 5);
  assert.equal(items[0].teacher_name, "Alice");
  assert.equal(items[0].performance, "excellent");
});

test("GET /students/:id/report 无课时计划时出勤率为 null", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: ID }], error: null }, // 老师被分配了该学员的课程
    { data: [], error: null }, // 暂无已上课记录
    { data: [], error: null },
    { data: [], error: null },
    { data: null, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: `/${ID}/report?from=2026-09-01&to=2026-09-30`,
    testUser: { id: "t1", role: "teacher" },
  });
  await handler(req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data.metrics.attendance_rate, null);
  assert.equal(captured.body.data.metrics.remaining_hours, 0);
});
test("家长学习报告仅返回已发布反馈，草稿不会经列表或导出泄露", async () => {
  resetMock();
  setMockResults([
    { data: [{ student_id: ID }], error: null },
    {
      data: [
        {
          id: "lesson-draft",
          status: "completed",
          duration_min: 60,
          records: [{ id: "draft", performance: "未发布的内部备注", homework: "草稿作业" }],
        },
        {
          id: "lesson-published",
          status: "completed",
          duration_min: 60,
          records: { id: "published", performance: "已发布表现" },
        },
      ],
      error: null,
    },
    { data: [{ record_id: "published" }], error: null },
    { data: { remaining_hours: 12 }, error: null },
  ]);
  const { req, res, captured } = applyMiddleware({
    method: "GET",
    url: `/${ID}/report`,
    testUser: { id: "parent", role: "parent" },
  });
  await handler(req, res);
  assert.equal(captured.statusCode, 200);
  const text = JSON.stringify(captured.body);
  assert(!text.includes("未发布的内部备注"));
  assert(!text.includes("草稿作业"));
  assert(text.includes("已发布表现"));
});
