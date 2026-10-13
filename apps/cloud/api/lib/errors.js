class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

// DomainError code -> HTTP status mapping
const DOMAIN_STATUS = {
  SCHEDULE_CONFLICT: 409,
  INSUFFICIENT_HOURS: 402,
  LESSON_NOT_FOUND: 404,
  LESSON_NOT_OWNED: 403,
  LESSON_ALREADY_COMPLETED: 409,
  STUDENT_NOT_FOUND: 404,
};

// ⚠️ reqId 必须回给客户端：线上排障时只有客户端能拿到它，
// 才能把「用户看到的报错」和日志里的 unhandled_error / x-request-id 对上。
// 漏掉它等于这条排障链路断掉 —— 所以 5xx 一律带上。
function toResponse(err, reqId) {
  if (err.status && err.code) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        details: err.details,
        ...(err.status >= 500 ? { reqId: reqId ?? null } : {}),
      },
    };
  }
  if (err.code && DOMAIN_STATUS[err.code]) {
    return {
      status: DOMAIN_STATUS[err.code],
      body: {
        error: err.message,
        code: err.code,
        details: err.details ?? null,
        ...(DOMAIN_STATUS[err.code] >= 500 ? { reqId: reqId ?? null } : {}),
      },
    };
  }
  return { status: 500, body: { error: "服务器错误", reqId: reqId ?? null } };
}

function withErrorHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const { status, body } = toResponse(err, req?.reqId);
      if (status >= 500) {
        const { error: logError } = require("./log.js");
        logError("unhandled_error", {
          reqId: req?.reqId,
          path: req?.url?.replace(/\/callback\/[a-f0-9]{64}/g, "/callback/[redacted]"),
          err: { name: err.name, message: err.message, stack: err.stack },
        });
      }
      res.status(status).json(body);
    }
  };
}

module.exports = { HttpError, toResponse, withErrorHandler };
