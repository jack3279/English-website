const store = require("./secureStore.js");
const { HttpError } = require("./errors.js");
async function withLock(key, run) {
  if (!store.ready()) return run();
  const name = `private/workflow-locks/${key}`,
    owner = store.randomId();
  await store.change(name, null, (current) => {
    if (current?.owner && current.until > Date.now())
      throw new HttpError(409, "WORKFLOW_BUSY", "这笔业务正在处理，请稍后重试");
    return { owner, until: Date.now() + 300000 };
  });
  try {
    return await run();
  } finally {
    await store.change(name, null, (current) =>
      current?.owner === owner ? { owner: null, until: 0 } : null,
    );
  }
}
module.exports = { withLock };
