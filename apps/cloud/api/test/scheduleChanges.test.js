const test = require("node:test");
const assert = require("node:assert/strict");
const { addScheduleChanges } = require("../lib/scheduleChanges.js");
const { setMockResults, resetMock } = require("./setup.js");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const schedules = require("../routes/schedules.js");
const lessons = require("../routes/lessons.js");
const USER = { id: "00000000-0000-0000-0000-000000000001", role: "admin" };
const ID = "00000000-0000-0000-0000-000000000011";
const row = {
  id: ID,
  teacher_id: USER.id,
  student_id: "00000000-0000-0000-0000-000000000012",
  status: "scheduled",
  scheduled_at: "2026-10-09T08:00:00Z",
  duration_min: 60,
};
test.afterEach(resetMock);
function fakeAdmin(result) {
  const calls = [];
  const q = {
    select() {
      return q;
    },
    eq(key, value) {
      calls.push([key, value]);
      return q;
    },
    in(key, values) {
      calls.push([key, values]);
      return q;
    },
    order() {
      return q;
    },
    limit: async () => result,
  };
  return { from: () => q, calls };
}
test("调课标记仅关联已授权课节，不返回审计操作者及其他课节", async () => {
  const admin = fakeAdmin({
    data: [
      {
        target_id: ID,
        action: "lesson.reschedule",
        created_at: "2026-10-08T00:00:00Z",
        payload: { from: "2026-10-09T07:00:00Z", to: row.scheduled_at, actor: "private" },
      },
      {
        target_id: "foreign",
        action: "lesson.reschedule",
        created_at: "2026-10-08T01:00:00Z",
        payload: { from: "old", to: "new" },
      },
    ],
    error: null,
  });
  const result = await addScheduleChanges(admin, [row]);
  assert.equal(result.length, 1);
  assert.equal(result[0].rescheduled_at, "2026-10-08T00:00:00Z");
  assert.equal(result[0].actor, undefined);
  assert.deepEqual(admin.calls.find((call) => call[0] === "target_id")[1], [ID]);
});
test("审计读取失败不会把课表打空，并明确标记记录暂不可用", async () => {
  const result = await addScheduleChanges(fakeAdmin({ data: null, error: new Error("offline") }), [
    row,
  ]);
  assert.equal(result[0].id, ID);
  assert.equal(result[0].change_history_available, false);
});
test("未发生实际时间变化的历史记录不标成调课", async () => {
  const result = await addScheduleChanges(
    fakeAdmin({
      data: [
        {
          target_id: ID,
          action: "lesson.reschedule",
          payload: { from: row.scheduled_at, to: row.scheduled_at },
        },
      ],
      error: null,
    }),
    [row],
  );
  assert.equal(result[0].rescheduled_at, undefined);
});
test("列表可按需加载调课记录，保持原有数组响应形式", async () => {
  setMockResults([
    { data: [row], error: null },
    {
      data: [
        {
          target_id: ID,
          action: "schedule.update",
          created_at: "2026-10-08T00:00:00Z",
          payload: { schedule_changed: true },
        },
      ],
      error: null,
    },
  ]);
  const { req, res, captured } = applyMiddleware({ url: "/?includeChanges=true", testUser: USER });
  await mustHandler(schedules, req, res);
  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body.data[0].rescheduled_at, "2026-10-08T00:00:00Z");
});
test("冲突查询失败时不能继续创建或改期", async () => {
  setMockResults([{ data: null, error: new Error("conflict lookup failed") }]);
  const created = applyMiddleware({
    method: "POST",
    body: { teacher_id: USER.id, student_id: row.student_id, scheduled_at: "2026-10-10T08:00:00Z" },
    testUser: USER,
  });
  await mustHandler(schedules, created.req, created.res);
  assert.equal(created.captured.statusCode, 500);
  setMockResults([
    { data: row, error: null },
    { data: null, error: new Error("conflict lookup failed") },
  ]);
  const moved = applyMiddleware({
    method: "PATCH",
    url: `/${ID}`,
    body: { scheduled_at: "2026-10-10T08:00:00Z" },
    testUser: USER,
  });
  await mustHandler(lessons, moved.req, moved.res);
  assert.equal(moved.captured.statusCode, 500);
});
test("已完成课节不能通过管理员排课更新接口改时间或时长", async () => {
  setMockResults([{ data: { ...row, status: "completed" }, error: null }]);
  const { req, res, captured } = applyMiddleware({
    method: "PATCH",
    url: `/${ID}`,
    body: { duration_min: 90 },
    testUser: USER,
  });
  await mustHandler(schedules, req, res);
  assert.equal(captured.statusCode, 409);
});

test("已完课课程不能通过取消接口改写状态和课酬", async () => {
  setMockResults([{ data: { ...row, status: "completed" }, error: null }]);
  const request = applyMiddleware({ method: "DELETE", url: `/${ID}`, testUser: USER });
  await mustHandler(schedules, request.req, request.res);
  assert.equal(request.captured.statusCode, 409);
});
