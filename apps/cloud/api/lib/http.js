function json(res, status, payload) {
  res.status(status).json(payload);
}

function ok(res, data, meta) {
  json(res, 200, { data, ...(meta ? { meta } : {}) });
}

function badRequest(res, msg, details) {
  json(res, 400, { error: msg, code: "BAD_REQUEST", details });
}

function unauthorized(res, msg = "未登录") {
  json(res, 401, { error: msg, code: "UNAUTHORIZED" });
}

function forbidden(res, msg = "无权操作") {
  json(res, 403, { error: msg, code: "FORBIDDEN" });
}

function notFound(res, msg = "资源不存在") {
  json(res, 404, { error: msg, code: "NOT_FOUND" });
}

function conflict(res, code, msg, details) {
  json(res, 409, { error: msg, code, details });
}

function unprocessable(res, code, msg, details) {
  json(res, 422, { error: msg, code, details });
}

/**
 * 校验 ?status= 查询参数是否属于给定的 enum 白名单。
 *
 * 为什么必须校验: status 这类列在 Postgres 里是 **enum**, PostgREST 遇到
 * enum 之外的过滤值不会返回 400, 而是直接 500 —— 客户端拼错一个 status
 * 就能把整个列表接口打挂。凡是拿查询参数直接喂给 .eq("status", ...) 的地方
 * 都要先过这里。
 *
 * 返回 true = 合法(可以继续用); false = 已写过 400 响应(调用方直接 return)。
 */
function checkEnumParam(res, name, value, allowed) {
  if (value == null || value === "") return true;
  if (allowed.includes(value)) return true;
  badRequest(res, `${name} 非法`, { allowed });
  return false;
}

module.exports = {
  json,
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  checkEnumParam,
};
