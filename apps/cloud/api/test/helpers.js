// 集成测试 helper：mock Vercel 的 req/res
//
// ⚠️ mustHandler 的作用：handler 内部 `throw new HttpError(...)` 是本项目的正常错误路径
// （如「PATCH 命中 0 行 → 抛 404」）。生产环境由 withErrorHandler 兜底转成响应，
// 但测试直接调 handler 会让异常冒泡成测试失败、而不是可断言的 statusCode。
// 所以这里用真实的 withErrorHandler 包一层，让测试与生产走同一条错误路径。
const { withErrorHandler } = require("../lib/errors.js");

function applyMiddleware({ method = "GET", url = "/", body = null, headers = {}, testUser = null } = {}) {
  const captured = { statusCode: 200, headers: {}, body: null };
  const req = {
    method,
    url,
    body,
    headers,
    reqId: "test-req-1",
    __testUser: testUser,
  };
  const res = {
    _captured: captured,
    setHeader(k, v) {
      captured.headers[k.toLowerCase()] = v;
      return this;
    },
    status(c) {
      captured.statusCode = c;
      return this;
    },
    json(b) {
      captured.body = b;
      return this;
    },
    end() {
      return this;
    },
  };
  return { req, res, captured };
}

// 调用路由处理器，并把内部抛出的 HttpError 转成响应（与生产一致）
function mustHandler(handler, req, res) {
  return withErrorHandler(handler)(req, res);
}

module.exports = { applyMiddleware, mustHandler };
