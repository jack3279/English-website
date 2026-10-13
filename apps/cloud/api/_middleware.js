const { withErrorHandler } = require("./lib/errors.js");

module.exports = function topMiddleware(handler) {
  return withErrorHandler(async (req, res) => {
    return handler(req, res);
  });
};
