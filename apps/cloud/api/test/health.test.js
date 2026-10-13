const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../routes/health.js");
const { applyMiddleware } = require("./helpers.js");

test("health 返回 200 + ok", async () => {
  const { req, res } = applyMiddleware();
  await handler(req, res);
  assert.equal(res._captured.statusCode, 200);
  assert.equal(res._captured.body.data.status, "ok");
  assert.match(res._captured.body.data.ts, /^\d{4}-\d{2}-\d{2}T/);
});
