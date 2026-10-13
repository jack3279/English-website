const test = require("node:test");
const assert = require("node:assert/strict");
const courses = require("../routes/courses.js");
const { applyMiddleware, mustHandler } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");

const TEACHER = { id: "00000000-0000-4000-0000-000000000100", role: "teacher" };
const OTHER_TEACHER = { id: "00000000-0000-4000-0000-000000000101", role: "teacher" };
const PARENT = { id: "00000000-0000-4000-0000-000000000300", role: "parent" };
const ADMIN = { id: "00000000-0000-4000-0000-000000000001", role: "admin" };
const STUDENT = "00000000-0000-4000-0000-000000000200";
const COURSE_ID = "00000000-0000-4000-0000-000000000400";
const TEACHER_COURSE = {
  id: COURSE_ID,
  name: "Phonics",
  teacher_id: TEACHER.id,
  student_id: STUDENT,
  price_per_hour_cents: 20000,
  meeting_url: "https://meeting.example/secret",
};

function stubFetch(result) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  return { calls, restore: () => Object.assign(globalThis, { fetch: original }) };
}

async function call(user, method, url, body = null) {
  const { req, res, captured } = applyMiddleware({ url, method, body, testUser: user });
  await mustHandler(courses, req, res);
  return captured;
}

test.afterEach(() => {
  resetMock();
  test.mock.restoreAll();
});

test("家长只能列出关联学员的课程，且看不到单价和会议链接", async () => {
  setMockResults([
    { data: [{ student_id: STUDENT }], error: null },
    { data: [TEACHER_COURSE], error: null },
  ]);

  const response = await call(PARENT, "GET", "/");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.items.length, 1);
  assert.equal(response.body.data.items[0].price_per_hour_cents, undefined);
  assert.equal(response.body.data.items[0].meeting_url, undefined);
});

test("教师不能为其他教师或不可见学员创建课程模板", async () => {
  setMockResults([{ data: [], error: null }, { data: [], error: null }]);
  const response = await call(OTHER_TEACHER, "POST", "/", {
    name: "Unauthorized",
    teacher_id: TEACHER.id,
    student_id: STUDENT,
    weekday: 1,
    start_time: "09:00",
  });
  assert.equal(response.statusCode, 403);
});

test("教师创建课程时教师ID强制为本人，且原始写入走 REST INSERT", async () => {
  setMockResults([
    { data: [{ student_id: STUDENT }], error: null },
    { data: [], error: null },
    { data: [{ profile_id: TEACHER.id, active: true, branch_id: null }], error: null },
  ]);
  const inserted = [{ id: COURSE_ID, name: "Phonics", teacher_id: TEACHER.id }];
  const fetchStub = stubFetch(inserted);
  try {
    const response = await call(TEACHER, "POST", "/", {
      name: "Phonics",
      teacher_id: OTHER_TEACHER.id,
      student_id: STUDENT,
      weekday: 1,
      start_time: "09:00",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.id, COURSE_ID);
    assert.equal(fetchStub.calls[0].url.includes("/courses"), true);
    assert.equal(fetchStub.calls[0].init.method, "POST");
    assert.equal(JSON.parse(fetchStub.calls[0].init.body)[0].teacher_id, TEACHER.id);
  } finally {
    fetchStub.restore();
  }
});

test("教师只能修改自己的课程模板，不能改派给其他教师", async () => {
  const updated = [{ id: COURSE_ID, name: "Updated", teacher_id: TEACHER.id }];
  const fetchStub = stubFetch(updated);
  try {
    const response = await call(TEACHER, "PATCH", `/${COURSE_ID}`, {
      name: "Updated",
      teacher_id: OTHER_TEACHER.id,
    });
    assert.equal(response.statusCode, 200);
    assert.match(fetchStub.calls[0].url, new RegExp(`id=eq\\.${COURSE_ID}`));
    assert.match(fetchStub.calls[0].url, new RegExp(`teacher_id=eq\\.${TEACHER.id}`));
    const body = JSON.parse(fetchStub.calls[0].init.body);
    assert.equal(body.teacher_id, undefined);
  } finally {
    fetchStub.restore();
  }
});

test("教师修改不属于自己的课程命中0行时返回404", async () => {
  const fetchStub = stubFetch([]);
  try {
    const response = await call(OTHER_TEACHER, "PATCH", `/${COURSE_ID}`, { name: "Nope" });
    assert.equal(response.statusCode, 404);
  } finally {
    fetchStub.restore();
  }
});

test("管理员仍可给在职教师创建课程模板", async () => {
  setMockResults([{ data: [{ profile_id: TEACHER.id, active: true, branch_id: null }], error: null }]);
  const inserted = [{ id: COURSE_ID, name: "Admin course", teacher_id: TEACHER.id }];
  const fetchStub = stubFetch(inserted);
  try {
    const response = await call(ADMIN, "POST", "/", {
      name: "Admin course",
      teacher_id: TEACHER.id,
      weekday: 2,
      start_time: "10:00",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(fetchStub.calls[0].init.body)[0].teacher_id, TEACHER.id);
  } finally {
    fetchStub.restore();
  }
});
