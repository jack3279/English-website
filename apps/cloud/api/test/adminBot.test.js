const test = require("node:test"),
  assert = require("node:assert/strict");
const bot = require("../lib/adminBot.js"),
  provider = require("../lib/adminBotProvider.js"),
  data = require("../lib/adminBotData.js"),
  handler = require("../routes/adminBot.js");
const { setMockResult, resetMock } = require("./setup.js"),
  { applyMiddleware, mustHandler } = require("./helpers.js");
class Bucket {
  constructor() {
    this.files = new Map();
    this.version = 0;
  }
  async get(key) {
    const row = this.files.get(key);
    return row ? { etag: row.etag, json: async () => JSON.parse(row.data) } : null;
  }
  async put(key, data, options) {
    const row = this.files.get(key);
    if (options?.onlyIf?.etagMatches && row?.etag !== options.onlyIf.etagMatches) return null;
    if (options?.onlyIf?.get?.("If-None-Match") === "*" && row) return null;
    const value = { data, etag: String(++this.version) };
    this.files.set(key, value);
    return value;
  }
}
const originals = {
  deepseek: provider.deepseek,
  send: provider.send,
  updates: provider.updates,
  start: provider.start,
  snapshot: data.snapshot,
  ownerAccount: data.ownerAccount,
  upcomingLessons: data.upcomingLessons,
  currentLesson: data.currentLesson,
};
let calls, sends, bucket;
test.beforeEach(async () => {
  bucket = new Bucket();
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: bucket,
    PUSHPLUS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  };
  setMockResult({ data: { role: "admin" }, error: null });
  calls = 0;
  sends = [];
  provider.deepseek = async () => {
    calls++;
    return { reply: "请查看网站待办", cost: 1000 };
  };
  provider.send = async (...args) => {
    sends.push(args);
    return { ret: 0 };
  };
  provider.updates = async () => ({ ret: 0, msgs: [], get_updates_buf: "cursor" });
  provider.start = async () => ({ ret: 0 });
  data.ownerAccount = async () => {};
  data.upcomingLessons = async () => [];
  data.currentLesson = async () => null;
  data.snapshot = async (names) => ({
    needsAttention: { leavePendingOver2Hours: 1 },
    ...(names ? { lowBalanceNames: [{ name: "学生A" }] } : {}),
  });
});
test.afterEach(() => {
  Object.assign(provider, {
    deepseek: originals.deepseek,
    send: originals.send,
    updates: originals.updates,
    start: originals.start,
  });
  data.snapshot = originals.snapshot;
  data.ownerAccount = originals.ownerAccount;
  data.upcomingLessons = originals.upcomingLessons;
  data.currentLesson = originals.currentLesson;
  delete globalThis.__CLOUDFLARE_ENV;
  resetMock();
});
async function configure(extra = {}) {
  await bot.change((c) => ({
    ...c,
    ownerId: "admin",
    apiKey: "secret-ai-key-never-echo",
    consent: true,
    version: 1,
    ...extra,
  }));
}
const peer = {
  peer: "own-wechat",
  id: "my-bot",
  token: "secret-wechat-token",
  base: provider.BASE,
};
const msg = {
  from_user_id: peer.peer,
  to_user_id: peer.id,
  message_type: 1,
  message_state: 0,
  message_id: 12,
  create_time_ms: 100,
  context_token: "own-context",
  item_list: [{ type: 1, text_item: { text: "今天有哪些待办" } }],
};
test("默认停用时不接收微信、不调用模型", async () => {
  provider.updates = () => assert.fail("不应连接微信");
  assert.deepEqual(await bot.tick(), { disabled: true });
  assert.equal(calls, 0);
});
test("配置接口仅管理员可用，密钥和微信凭据不回显", async () => {
  await configure({ bot: peer });
  const parent = applyMiddleware({ url: "/settings", testUser: { id: "parent", role: "parent" } });
  await mustHandler(handler, parent.req, parent.res);
  assert.equal(parent.captured.statusCode, 403);
  const admin = applyMiddleware({ url: "/settings", testUser: { id: "admin", role: "admin" } });
  await mustHandler(handler, admin.req, admin.res);
  assert.equal(admin.captured.statusCode, 200);
  const text = JSON.stringify(admin.captured.body);
  assert(!text.includes("secret-ai-key"));
  assert(!text.includes("secret-wechat-token"));
  assert(![...bucket.files.values()][0].data.includes("secret-ai-key"));
});
test("其他管理员不能读取或接管已有机器人", async () => {
  await configure();
  assert.throws(() => bot.view({ ownerId: "admin" }, "other"), { code: "BOT_OWNER_ONLY" });
});
test("公开测试初始密码不能配置API密钥", async () => {
  await assert.rejects(
    bot.save({ context: { userId: "admin" } }, { current_password: "Demo1234!" }),
    { code: "BOT_SECURE_ACCOUNT_REQUIRED" },
  );
  assert.equal((await bot.state()).ownerId, null);
});
test("同一提问编号只调用模型一次，改变内容拒绝重用", async () => {
  await configure();
  assert.equal(await bot.answer("q1", "待办"), "请查看网站待办");
  assert.equal(await bot.answer("q1", "待办"), "请查看网站待办");
  await assert.rejects(bot.answer("q1", "不同问题"), { code: "BOT_REQUEST_CHANGED" });
  assert.equal(calls, 1);
});
test("并发提问不能突破每日额度", async () => {
  await configure({ dailyLimit: 1 });
  const responses = await Promise.allSettled([bot.answer("a", "问题A"), bot.answer("b", "问题B")]);
  assert.equal(responses.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
  assert.equal((await bot.state()).runtime.usage.calls, 1);
});
test("接口结果未知后不自动重复调用模型", async () => {
  await configure();
  provider.deepseek = async () => {
    calls++;
    throw new Error("network unknown");
  };
  await assert.rejects(bot.answer("q", "待办"));
  await assert.rejects(bot.answer("q", "待办"), { code: "BOT_ANSWER_UNKNOWN" });
  assert.equal(calls, 1);
});
test("陌生微信、群消息和Bot自发消息均不处理", () => {
  assert(bot.accepts(peer, msg));
  assert(!bot.accepts(peer, { ...msg, from_user_id: "other" }));
  assert(!bot.accepts(peer, { ...msg, group_id: "group" }));
  assert(!bot.accepts(peer, { ...msg, message_type: 2 }));
});
test("陌生人提问不消耗AI额度，也不发回复", async () => {
  await configure({ enabled: true, bot: peer });
  provider.updates = async () => ({
    ret: 0,
    get_updates_buf: "cursor",
    msgs: [{ ...msg, from_user_id: "other" }],
  });
  await bot.tick();
  assert.equal(calls, 0);
  assert.equal(sends.length, 0);
});
test("本人提问只回复本人，重复入站消息不重复付费或发送", async () => {
  await configure({ enabled: true, bot: peer });
  provider.updates = async () => ({ ret: 0, get_updates_buf: "cursor", msgs: [msg] });
  await bot.tick();
  await bot.tick();
  assert.equal(calls, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0].peer, "own-wechat");
  assert.equal(sends[0][1], "own-context");
});
test("未发送网站绑定码时不能建立查询关系", async () => {
  await configure({
    enabled: false,
    pair: { id: "pair", candidate: peer, code: "12345678", until: Date.now() + 60000, cursor: "" },
  });
  provider.updates = async () => ({ ret: 0, msgs: [msg], get_updates_buf: "cursor" });
  const result = await bot.tick();
  assert.equal(result.bindingConfirmed, false);
  assert.equal((await bot.state()).bot, null);
  assert.equal(calls, 0);
});
test("本人发送绑定码后建立关系，但仍保持停用", async () => {
  await configure({
    enabled: false,
    pair: { id: "pair", candidate: peer, code: "12345678", until: Date.now() + 60000, cursor: "" },
  });
  provider.updates = async () => ({
    ret: 0,
    msgs: [{ ...msg, item_list: [{ type: 1, text_item: { text: "绑定 12345678" } }] }],
    get_updates_buf: "consumed-binding-cursor",
  });
  const result = await bot.tick();
  assert.equal(result.bindingConfirmed, true);
  const c = await bot.state();
  assert.equal(c.bot.peer, peer.peer);
  assert.equal(c.enabled, false);
  assert.equal(c.runtime.cursor, "consumed-binding-cursor");
  assert.equal(calls, 0);
});
test("未启用但等待绑定码时先通知微信启动，再接收本人验证", async () => {
  await configure({
    enabled: false,
    pair: {
      id: "pair",
      image: "qr-image",
      candidate: peer,
      code: "12345678",
      until: Date.now() + 60000,
      cursor: "",
    },
  });
  const order = [];
  provider.start = async (candidate) => {
    assert.equal(candidate.token, peer.token);
    order.push("start");
  };
  provider.updates = async () => {
    order.push("updates");
    return { ret: 0, msgs: [], get_updates_buf: "cursor" };
  };
  await bot.tick();
  assert.deepEqual(order, ["start", "updates"]);
  const view = bot.view(await bot.state(), "admin");
  assert.equal(view.binding.bindText, "绑定 12345678");
  assert.equal(view.binding.image, "qr-image");
  assert.equal(JSON.stringify(view).includes(peer.token), false);
  assert.equal(calls, 0);
});
test("微信启动通知失败不阻断消息轮询，并显示独立状态", async () => {
  await configure({ enabled: true, bot: peer });
  provider.start = async () => {
    throw new Error("启动通知失败");
  };
  let polled = false;
  provider.updates = async () => {
    polled = true;
    return { ret: 0, msgs: [], get_updates_buf: "cursor" };
  };
  await bot.tick();
  assert.equal(polled, true);
  assert.equal(bot.view(await bot.state(), "admin").connectionWarning, "启动通知失败");
});
test("绑定码兼容全角数字与空格，不接受额外内容或其他人的码", async () => {
  for (const text of ["绑定12345678", "绑定　１２３４５６７８", "12345678"]) {
    await configure({
      enabled: false,
      bot: null,
      pair: {
        id: "pair",
        candidate: peer,
        code: "12345678",
        until: Date.now() + 60000,
        cursor: "",
      },
    });
    provider.updates = async () => ({
      ret: 0,
      msgs: [{ ...msg, item_list: [{ type: 1, text_item: { text } }] }],
    });
    assert.equal((await bot.tick()).bindingConfirmed, true);
  }
  for (const text of ["请帮我绑定12345678", "绑定 87654321"]) {
    await configure({
      enabled: false,
      bot: null,
      pair: {
        id: "pair",
        candidate: peer,
        code: "12345678",
        until: Date.now() + 60000,
        cursor: "",
      },
    });
    provider.updates = async () => ({
      ret: 0,
      msgs: [{ ...msg, item_list: [{ type: 1, text_item: { text } }] }],
    });
    assert.equal((await bot.tick()).bindingConfirmed, false);
  }
  provider.updates = async () => ({
    ret: 0,
    msgs: [
      {
        ...msg,
        from_user_id: "stranger",
        item_list: [{ type: 1, text_item: { text: "绑定 12345678" } }],
      },
    ],
  });
  assert.equal((await bot.tick()).bindingConfirmed, false);
  assert.equal(bot.view(await bot.state(), "admin").bindingCheck.ownSender, 0);
});
test("AI调用期间暂停或修改配置后不再发送旧回复", async () => {
  await configure({ enabled: true, bot: peer });
  provider.updates = async () => ({ ret: 0, msgs: [msg], get_updates_buf: "cursor" });
  provider.deepseek = async () => {
    await bot.change((c) => ({ ...c, enabled: false, version: c.version + 1 }));
    return { reply: "旧回复", cost: 1000 };
  };
  await bot.tick();
  assert.equal(sends.length, 0);
  assert.equal((await bot.state()).runtime.history.length, 0);
});
test("微信区域接口必须属于官方HTTPS域名", () => {
  assert.throws(() => provider.validBase("http://127.0.0.1"));
  assert.throws(() => provider.validBase("https://attacker.example"));
  assert.equal(provider.validBase("https://ilinkai.weixin.qq.com/"), provider.BASE);
});

test("管理员账号停用后不再读取数据、调用AI或给微信发送", async () => {
  await configure({ enabled: true, bot: peer });
  data.ownerAccount = async () => {
    throw Object.assign(new Error("账号停用"), { code: "BOT_OWNER_INACTIVE" });
  };
  provider.updates = () => assert.fail("不应再连接微信");
  const result = await bot.tick();
  assert.equal(result.error, "BOT_OWNER_INACTIVE");
  assert.equal(calls, 0);
  assert.equal(sends.length, 0);
});

function upcoming(id = "lesson") {
  return {
    id,
    status: "scheduled",
    scheduled_at: new Date(Date.now() + 25 * 60000).toISOString(),
    duration_min: 60,
    students: { full_name: "学生甲" },
    profiles: { full_name: "教师乙" },
    courses: { name: "口语" },
  };
}
async function lessonConfig() {
  await configure({
    enabled: true,
    bot: peer,
    lessonReminders: true,
    lessonReminderMinutes: 30,
    runtime: { ...structuredClone(bot.DEFAULT.runtime), context: "own-context" },
  });
}
test("课前通知只发送本人且去重，不调用AI或消耗问答额度", async () => {
  await lessonConfig();
  const lesson = upcoming();
  data.upcomingLessons = async () => [lesson];
  data.currentLesson = async () => lesson;
  await bot.tick();
  await bot.tick();
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0].peer, peer.peer);
  assert.match(sends[0][2], /学生甲/);
  assert.match(sends[0][2], /教师乙/);
  assert.match(sends[0][2], /北京时间/);
  assert.equal(calls, 0);
  assert.equal((await bot.state()).runtime.lastLessonReminder.state, "submitted");
});
test("提醒发送前发现取消、调至窗口外或已开课则不发送", async () => {
  await lessonConfig();
  const lesson = upcoming();
  data.upcomingLessons = async () => [lesson];
  for (const updated of [
    { ...lesson, status: "cancelled" },
    { ...lesson, scheduled_at: new Date(Date.now() + 3600000).toISOString() },
    { ...lesson, scheduled_at: new Date(Date.now() - 60000).toISOString() },
  ]) {
    data.currentLesson = async () => updated;
    await bot.tick();
  }
  assert.equal(sends.length, 0);
});
test("课前发送结果未知不自动重复，页面保留可核对状态", async () => {
  await lessonConfig();
  const lesson = upcoming();
  data.upcomingLessons = async () => [lesson];
  data.currentLesson = async () => lesson;
  let attempts = 0;
  provider.send = async () => {
    attempts++;
    throw new Error("微信请求结果未知");
  };
  await bot.tick();
  await bot.tick();
  assert.equal(attempts, 1);
  assert.equal((await bot.state()).runtime.lastLessonReminder.state, "unknown");
});
test("提醒期间暂停机器人后不再发送", async () => {
  await lessonConfig();
  const lesson = upcoming();
  data.upcomingLessons = async () => [lesson];
  data.currentLesson = async () => {
    await bot.change((c) => ({ ...c, enabled: false, version: c.version + 1 }));
    return lesson;
  };
  await bot.tick();
  assert.equal(sends.length, 0);
});
test("多节同时上课的提醒分批处理，后续批次不被已发送课程挡住", async () => {
  await lessonConfig();
  const lessons = Array.from({ length: 7 }, (_, i) => upcoming(`lesson${i}`));
  data.upcomingLessons = async () => lessons;
  data.currentLesson = async (id) => lessons.find((l) => l.id === id);
  await bot.tick();
  assert.equal(sends.length, 5);
  await bot.tick();
  assert.equal(sends.length, 7);
  assert.equal(new Set(sends.map((s) => s[3])).size, 7);
});

test("原管理员助手原地保留，新管理员不会读取旧密钥、绑定与历史", async () => {
  await configure({
    enabled: true,
    bot: peer,
    runtime: {
      ...structuredClone(bot.DEFAULT.runtime),
      history: [{ role: "user", content: "原管理员私有对话", at: Date.now() }],
    },
  });
  const before = JSON.stringify(await bot.state());
  const original = await bot.forUser("admin"),
    other = await bot.forUser("admin-two");
  assert.equal(original.KEY, bot.KEY);
  assert.equal(JSON.stringify(await bot.state()), before);
  const view = other.view(await other.state(), "admin-two");
  assert.equal(view.configured, false);
  assert.equal(view.keyConfigured, false);
  assert.equal(view.bound, false);
  assert.deepEqual(view.history, []);
  const call = applyMiddleware({ url: "/settings", testUser: { id: "admin-two", role: "admin" } });
  await mustHandler(handler, call.req, call.res);
  assert.equal(call.captured.statusCode, 200);
  assert.equal(call.captured.body.data.keyConfigured, false);
});
test("两个管理员的锁、同号问答、额度和历史相互独立", async () => {
  await configure({ enabled: true, bot: peer });
  const first = await bot.forUser("admin"),
    second = await bot.forUser("admin-two");
  await second.change((c) => ({
    ...c,
    ownerId: "admin-two",
    consent: true,
    apiKey: "another-private-key",
    enabled: true,
    dailyLimit: 1,
    bot: { ...peer, peer: "second-wechat", token: "second-token" },
  }));
  const lock1 = await first.lock(),
    lock2 = await second.lock();
  assert.ok(lock1);
  assert.ok(lock2);
  await Promise.all([
    first.answer("same-request", "甲的私有问题"),
    second.answer("same-request", "乙的私有问题"),
  ]);
  assert.equal(calls, 2);
  assert.match(JSON.stringify((await first.state()).runtime.history), /甲的私有问题/);
  assert.equal(
    JSON.stringify((await first.state()).runtime.history).includes("乙的私有问题"),
    false,
  );
  assert.match(JSON.stringify((await second.state()).runtime.history), /乙的私有问题/);
  await first.change((c) => ({ ...c, enabled: false }));
  assert.equal((await second.state()).enabled, true);
  await first.unlock(lock1);
  await second.unlock(lock2);
});
test("已有绑定的微信不能被另一个管理员重复绑定", async () => {
  await configure({ bot: peer });
  await bot.forUser("admin");
  const registry = require("../lib/adminBotRegistry.js");
  await registry.claimWechat("admin", peer.peer, Date.now() + 60000);
  await assert.rejects(registry.claimWechat("admin-two", peer.peer, Date.now() + 60000), {
    code: "BOT_WECHAT_ALREADY_BOUND",
  });
});
test("多人定时分发使用账号独立任务，单个账号失败不阻断其他助手", async () => {
  await configure({ enabled: true, bot: peer });
  const second = await bot.forUser("admin-two");
  await second.change((c) => ({ ...c, ownerId: "admin-two", enabled: true }));
  await bot.forUser("admin-two");
  const dispatched = [];
  globalThis.__CLOUDFLARE_ENV.ADMIN_BOT_WORKER = {
    tick: async (id) => {
      dispatched.push(id);
      if (id === "admin-two") throw new Error("模拟账号网络失败");
      return { processed: false };
    },
  };
  const outcome = await bot.tickAll();
  assert.deepEqual(dispatched.sort(), ["admin", "admin-two"]);
  assert.equal(outcome.accounts, 2);
  assert.equal(outcome.active, 2);
  assert.equal(outcome.errors, 1);
});
