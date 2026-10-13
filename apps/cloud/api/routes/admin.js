// /admin/* 分发器。Worker 里 /admin/import-rows 被映射到 /import-rows,
// 这里主要服务 dev-server 的自动扫描 (它按文件名注册 routes/*.js)。
const { HttpError } = require("../lib/errors.js");
const importRows = require("./importRows.js");

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const seg = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (seg === "import-rows") return importRows(req, res);
  throw new HttpError(404, "NOT_FOUND", `unknown admin route: ${seg || "/"}`);
};
