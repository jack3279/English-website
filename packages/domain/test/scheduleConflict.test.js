const test = require("node:test");
const assert = require("node:assert/strict");
const { detect } = require("../src/index.js");

const l = (id, teacher, student, start, dur = 60) => ({
  id,
  teacher_id: teacher,
  student_id: student,
  scheduled_at: start,
  duration_min: dur,
});

test("无冲突返回空数组", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [l("e1", "t2", "s2", "2026-09-07T17:00:00Z")],
  });
  assert.deepEqual(out, []);
});

test("同老师同时段冲突", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [l("e1", "t1", "s2", "2026-09-07T16:00:00Z")],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "teacher");
  assert.equal(out[0].with, "e1");
});

test("同学员同时段冲突", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [l("e1", "t2", "s1", "2026-09-07T16:00:00Z")],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "student");
});

test("时段相邻（背靠背）不冲突", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z", 60),
    existingLessons: [l("e1", "t1", "s1", "2026-09-07T17:00:00Z", 60)],
  });
  assert.equal(out.length, 0);
});

test("时段部分重叠冲突", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z", 90),
    existingLessons: [l("e1", "t1", "s2", "2026-09-07T17:00:00Z", 60)], // 不同 student → 只 1 个 teacher 冲突
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "teacher");
});

test("跨天不冲突", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T23:30:00Z", 60),
    existingLessons: [l("e1", "t1", "s1", "2026-09-08T00:30:00Z", 60)],
  });
  assert.equal(out.length, 0);
});

test("忽略 cancelled 状态的课次", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [{ ...l("e1", "t1", "s1", "2026-09-07T16:00:00Z"), status: "cancelled" }],
  });
  assert.equal(out.length, 0);
});

test("忽略 no_show 状态的课次", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [{ ...l("e1", "t1", "s1", "2026-09-07T16:00:00Z"), status: "no_show" }],
  });
  assert.equal(out.length, 0);
});

test("同老师+同学员同时冲突: 返回 2 个", () => {
  const out = detect({
    newLesson: l("new", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [l("e1", "t1", "s1", "2026-09-07T16:00:00Z")],
  });
  assert.equal(out.length, 2);
  assert.ok(out.some((c) => c.type === "teacher"));
  assert.ok(out.some((c) => c.type === "student"));
});

test("忽略 self (相同 id)", () => {
  const out = detect({
    newLesson: l("l-1", "t1", "s1", "2026-09-07T16:00:00Z"),
    existingLessons: [l("l-1", "t1", "s1", "2026-09-07T16:00:00Z")],
  });
  assert.equal(out.length, 0);
});
