const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");

const branchesRaw = require("../routes/branches.js");
const teachersRaw = require("../routes/teachers.js");
const studentsRaw = require("../routes/students.js");
const schedulesRaw = require("../routes/schedules.js");

const branches = withErrorHandler(branchesRaw);
const teachers = withErrorHandler(teachersRaw);
const students = withErrorHandler(studentsRaw);
const schedules = withErrorHandler(schedulesRaw);

test("branches 缺 token 返回 401", async () => {
  const { req, res } = applyMiddleware();
  await branches(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("teachers 缺 token 返回 401", async () => {
  const { req, res } = applyMiddleware();
  await teachers(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("students 缺 token 返回 401", async () => {
  const { req, res } = applyMiddleware();
  await students(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("schedules 缺 token 返回 401", async () => {
  const { req, res } = applyMiddleware({ method: "GET" });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("schedules POST -> create handler (需 token)", async () => {
  // POST /schedules 是 create, 没 token 走 auth -> 401
  const { req, res } = applyMiddleware({ method: "POST" });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 401);
});

test("schedules DELETE 无 id 返 405", async () => {
  // DELETE 必须带 id, 否则 405
  const { req, res } = applyMiddleware({ method: "DELETE" });
  await schedules(req, res);
  assert.equal(res._captured.statusCode, 405);
});
