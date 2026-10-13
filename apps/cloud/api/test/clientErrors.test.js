const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { applyMiddleware } = require("./helpers.js");
const { resetMock } = require("./setup.js");

const auditPath = path.join(__dirname, "..", "lib", "audit.js");

function loadHandlerWithAudit(calls) {
  delete require.cache[require.resolve("../routes/clientErrors.js")];
  const previousAudit = require.cache[auditPath];
  require.cache[auditPath] = {
    id: auditPath,
    filename: auditPath,
    loaded: true,
    exports: {
      record: async (...args) => {
        calls.push(args);
      },
    },
  };
  try {
    return require("../routes/clientErrors.js");
  } finally {
    if (previousAudit) require.cache[auditPath] = previousAudit;
    else delete require.cache[auditPath];
  }
}

const trustedUser = { id: "11111111-1111-4111-8111-111111111111", role: "parent" };
const forgedUser = "22222222-2222-4222-8222-222222222222";

test("匿名前端错误上报不能通过 body 的 userId 伪造审计 actor", async () => {
  resetMock();
  const calls = [];
  const handler = loadHandlerWithAudit(calls);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: {
      message: "boom",
      stack: "TypeError: boom",
      url: "https://17say.org/bad",
      userAgent: "vitest",
      userId: forgedUser,
    },
  });

  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], null);
  assert.equal(calls[0][1], "client.error");
  assert.equal(calls[0][4].userId, undefined);
  assert.equal(calls[0][4].message, "boom");
});

test("已登录用户的前端错误审计 actor 只取服务端登录态", async () => {
  resetMock();
  const calls = [];
  const handler = loadHandlerWithAudit(calls);
  const { req, res, captured } = applyMiddleware({
    method: "POST",
    url: "/",
    body: {
      message: "boom after login",
      userId: forgedUser,
    },
    headers: { authorization: "Bearer trusted-token" },
    testUser: trustedUser,
  });

  await handler(req, res);

  assert.equal(captured.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], trustedUser.id);
  assert.equal(calls[0][4].userId, undefined);
});
