const { getAdmin, createAuthClient } = require("./supabase.js");
const { HttpError } = require("./errors.js");
async function verify(req, password) {
  if (req.context.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED", "仅管理员可以执行");
  if (!password || password === "Demo1234!")
    throw new HttpError(400, "SECURE_PASSWORD_REQUIRED", "请使用正式管理员密码确认操作");
  const { data, error } = await getAdmin().auth.getUser(req.context.jwt);
  if (error || data?.user?.id !== req.context.userId)
    throw new HttpError(401, "UNAUTHORIZED", "请重新登录");
  const authClient = createAuthClient();
  try {
    const checked = await authClient.auth.signInWithPassword({ email: data.user.email, password });
    if (checked.error || checked.data?.user?.id !== req.context.userId)
      throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "当前管理员密码不正确");
  } finally {
    try {
      await authClient.auth.signOut({ scope: "local" });
    } catch {}
  }
}
module.exports = { verify };
