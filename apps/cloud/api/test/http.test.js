const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpError, toResponse, withErrorHandler } = require("../lib/errors.js");
const {
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
} = require("../lib/http.js");
const { applyMiddleware } = require("./helpers.js");

test("HttpError 携带 status + code + details", () => {
  const e = new HttpError(409, "LESSON_ALREADY_COMPLETED", "已完课", { lessonId: "l-1" });
  assert.equal(e.status, 409);
  assert.equal(e.code, "LESSON_ALREADY_COMPLETED");
  assert.equal(e.details.lessonId, "l-1");
});

test("toResponse 已知业务错误带 details", () => {
  const e = new HttpError(422, "INSUFFICIENT_HOURS", "余额不足");
  const r = toResponse(e);
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "INSUFFICIENT_HOURS");
  assert.equal(r.body.error, "余额不足");
});

test("toResponse 未知错误降级到 500", () => {
  const r = toResponse(new Error("boom"));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, "服务器错误");
});

test("withErrorHandler 包装后正常返回", async () => {
  const wrapped = withErrorHandler(async (req, res) => {
    res.status(200).json({ data: { ok: true } });
  });
  const { req, res } = applyMiddleware();
  await wrapped(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.deepEqual(res._captured.body, { data: { ok: true } });
});

test("withErrorHandler 业务错误转 4xx", async () => {
  const wrapped = withErrorHandler(async () => {
    throw new HttpError(404, "NOT_FOUND", "没了");
  });
  const { req, res } = applyMiddleware();
  await wrapped(req, res);
  assert.equal(res._captured.statusCode, 404);
  assert.equal(res._captured.body.code, "NOT_FOUND");
});

test("ok / badRequest / unauthorized / forbidden / notFound / conflict / unprocessable", () => {
  const { res } = applyMiddleware();
  ok(res, { x: 1 }, { total: 10 });
  assert.equal(res._captured.statusCode, 200);
  assert.deepEqual(res._captured.body, { data: { x: 1 }, meta: { total: 10 } });

  badRequest(res, "x");
  assert.equal(res._captured.statusCode, 400);
  unauthorized(res);
  assert.equal(res._captured.statusCode, 401);
  forbidden(res);
  assert.equal(res._captured.statusCode, 403);
  notFound(res);
  assert.equal(res._captured.statusCode, 404);
  conflict(res, "C1", "m");
  assert.equal(res._captured.statusCode, 409);
  unprocessable(res, "U1", "m");
  assert.equal(res._captured.statusCode, 422);
});
