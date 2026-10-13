const store = require("./secureStore.js");
const { HttpError } = require("./errors.js");
const KEY = "private/admin-bot/registry-v1";
const EMPTY = { users: [], wechat: {} };
async function users() {
  return (await store.read(KEY, EMPTY)).value.users;
}
async function register(userId) {
  return store.change(KEY, EMPTY, (r) =>
    r.users.includes(userId) ? null : { ...r, users: [...r.users, userId] },
  );
}
async function importLegacy(c) {
  if (!c.ownerId || !store.ready()) return;
  const peer = c.bot?.peer ? await store.hash(c.bot.peer) : null;
  await store.change(KEY, EMPTY, (r) => {
    if (
      r.users.includes(c.ownerId) &&
      (!peer || (r.wechat[peer]?.userId === c.ownerId && r.wechat[peer]?.until === null))
    )
      return null;
    if (peer && r.wechat[peer] && r.wechat[peer].userId !== c.ownerId)
      throw new HttpError(409, "BOT_WECHAT_ALREADY_BOUND", "该微信已绑定另一个管理员账号");
    return {
      ...r,
      users: [...new Set([...r.users, c.ownerId])],
      wechat: { ...r.wechat, ...(peer ? { [peer]: { userId: c.ownerId, until: null } } : {}) },
    };
  });
}
async function claimWechat(userId, peer, until) {
  const key = await store.hash(peer),
    now = Date.now();
  return store.change(KEY, EMPTY, (r) => {
    const existing = r.wechat[key];
    if (existing && existing.userId !== userId && (existing.until === null || existing.until > now))
      throw new HttpError(
        409,
        "BOT_WECHAT_ALREADY_BOUND",
        "该微信已绑定另一个管理员账号，请使用本人独立的微信",
      );
    const wechat = Object.fromEntries(
      Object.entries(r.wechat).filter(
        ([id, v]) =>
          id === key ||
          (v.until === null ? !(until === null && v.userId === userId) : v.until > now),
      ),
    );
    const expires = existing?.userId === userId && existing.until === null ? null : until;
    return { ...r, wechat: { ...wechat, [key]: { userId, until: expires } } };
  });
}
module.exports = { users, register, importLegacy, claimWechat };
