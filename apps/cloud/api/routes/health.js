// 健康检查端点。Phase 4 之后会被 _middleware.js 包装并加 reqId。
module.exports = async function handler(req, res) {
  res.status(200).json({ data: { status: "ok", ts: new Date().toISOString() } });
};
