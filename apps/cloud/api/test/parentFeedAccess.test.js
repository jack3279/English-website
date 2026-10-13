const test = require("node:test");
const assert = require("node:assert/strict");
const parent = require("../routes/parent.js");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

const TEACHER = { id: "00000000-0000-4000-0000-000000000100", role: "teacher" };
const OTHER_TEACHER = { id: "00000000-0000-4000-0000-000000000101", role: "teacher" };
const STUDENT = "00000000-0000-4000-0000-000000000200";
const FEED = "00000000-0000-4000-0000-000000000500";
const RECORD = "00000000-0000-4000-0000-000000000600";
const LESSON = "00000000-0000-4000-0000-000000000700";

async function call(user, url = `/feeds?studentId=${STUDENT}`) {
  const { req, res, captured } = applyMiddleware({ method: "GET", url, testUser: user });
  await parent(req, res);
  return captured;
}

test.afterEach(() => {
  resetMock();
});

test("教师不能读取不可见学员的家长反馈", async () => {
  setMockResults([{ data: [], error: null }, { data: [], error: null }]);
  const response = await call(OTHER_TEACHER);
  assert.equal(response.statusCode, 403);
});

test("教师只能看到自己课节产生的反馈详情", async () => {
  setMockResults([
    { data: [{ student_id: STUDENT }], error: null },
    { data: [], error: null },
    {
      data: [
        { id: FEED, record_id: RECORD, student_id: STUDENT, summary: "summary", published_at: "2026-10-10" },
      ],
      count: 1,
      error: null,
    },
    {
      data: [{ id: RECORD, lesson_id: LESSON, content: "自己的课", performance: "good", homework: "hw", next_plan: "next" }],
      error: null,
    },
    // 查询 lessons.teacher_id=本人 时返回 0 行，模拟该反馈属于其他教师
    { data: [], error: null },
  ]);

  const response = await call(TEACHER);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, []);
});

test("教师可以读取可见学员且由本人课节产生的反馈", async () => {
  setMockResults([
    { data: [{ student_id: STUDENT }], error: null },
    { data: [], error: null },
    {
      data: [
        { id: FEED, record_id: RECORD, student_id: STUDENT, summary: "summary", published_at: "2026-10-10" },
      ],
      count: 1,
      error: null,
    },
    {
      data: [{ id: RECORD, lesson_id: LESSON, content: "自己的课", performance: "good", homework: "hw", next_plan: "next" }],
      error: null,
    },
    {
      data: [
        {
          id: LESSON,
          teacher_id: TEACHER.id,
          scheduled_at: "2026-10-10T01:00:00.000Z",
          duration_min: 60,
          status: "completed",
          leave_status: null,
        },
      ],
      error: null,
    },
    { data: [{ id: TEACHER.id, full_name: "老师甲" }], error: null },
  ]);

  const response = await call(TEACHER);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].content, "自己的课");
  assert.equal(response.body.data[0].teacher_name, "老师甲");
});
