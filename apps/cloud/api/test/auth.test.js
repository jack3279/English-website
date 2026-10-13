const test = require("node:test");
const assert = require("node:assert/strict");
const handlerRaw = require("../routes/auth.js");
const { applyMiddleware } = require("./helpers.js");
const { withErrorHandler } = require("../lib/errors.js");

const handler = withErrorHandler(handlerRaw);

test("login 缺参数返回 400", async () => {
  const { req, res } = applyMiddleware({ method: "POST", url: "/login", body: {} });
  await handler(req, res);
  assert.equal(res._captured.statusCode, 400);
  assert.equal(res._captured.body.code, "BAD_REQUEST");
});

test("login 邮箱非法返回 400", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/login",
    body: { email: "not-an-email", password: "x" },
  });
  await handler(req, res);
  assert.equal(res._captured.statusCode, 400);
});

test("unknown 路径返回 404", async () => {
  const { req, res } = applyMiddleware({ method: "POST", url: "/foo" });
  await handler(req, res);
  assert.equal(res._captured.statusCode, 404);
});

test("signup 已关闭公开注册", async () => {
  const { req, res } = applyMiddleware({
    method: "POST",
    url: "/signup",
    body: { email: "parent@example.com", password: "secret1", full_name: "家长" },
  });
  await handler(req, res);
  assert.equal(res._captured.statusCode, 403);
  assert.match(res._captured.body.error, /关闭公开注册/);
});

test("logout 返回 200 + logged_out", async () => {
  const { req, res } = applyMiddleware({ method: "POST", url: "/logout" });
  await handler(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.logged_out, true);
});
