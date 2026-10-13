// /makeups 补课单。
// 与请假共用 routes/leave.js 的逻辑(两张表强关联: 请假批准 -> 生成补课单),
// 这里只负责把被入口剥掉的 "/makeups" 段补回去, 保证 dev-server 的自动扫描也能注册到。

const leave = require("./leave.js");

module.exports = async function handler(req, res) {
  const raw = String(req.url || "/");
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const qs = qIdx === -1 ? "" : raw.slice(qIdx);
  const patched = Object.create(req);
  patched.url = (path.startsWith("/makeups") ? path : `/makeups${path === "/" ? "" : path}`) + qs;
  return leave(patched, res);
};
