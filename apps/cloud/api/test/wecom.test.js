// 企业微信通道测试。
// 重点: 未配置凭证必须优雅跳过(这是"不配也能上线"的保证),
// 配置后必须按企微要求的结构发消息, 且 token 必须复用(企微 token 有频率限制)。
//
// 注意: wecom.js 的 token 缓存在模块作用域(生产上是刻意设计, 让同一 isolate 复用),
// 所以每个用例都用**不同的企业ID/Secret**, 让缓存键互不干扰, 否则用例间会串。
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_PUSH_PER_RUN,
  getWeComConfig,
  appEnabled,
  extEnabled,
  sendAppMessage,
  sendExternalMessage,
  runBatch,
  lessonContent,
  renewalContent,
  lessonReminderJobs,
  renewalJobs,
} = require("../src/wecom.js");

// 每个用例传自己的 tag, 拿到一套互不相同的凭证
const creds = (tag) => ({
  WECHAT_CORP_ID: `ww_${tag}`,
  WECHAT_CORP_SECRET: `app_${tag}`,
  WECHAT_AGENT_ID: "1000002",
  WECHAT_EXTCONTACT_SECRET: `ext_${tag}`,
});

function withEnv(env) {
  const prev = globalThis.__CLOUDFLARE_ENV;
  globalThis.__CLOUDFLARE_ENV = env;
  return () => {
    globalThis.__CLOUDFLARE_ENV = prev;
  };
}

// 记录 fetch 调用, 按 url 决定返回内容
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    const payload = handler(String(url));
    return { status: 200, text: async () => JSON.stringify(payload) };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const TOKEN_OK = { errcode: 0, access_token: "TOKEN_1", expires_in: 7200 };

test.afterEach(() => {
  globalThis.__CLOUDFLARE_ENV = undefined;
});

test("未配置凭证时两类发送都优雅跳过, 且不发起任何请求", async () => {
  const f = stubFetch(() => ({}));
  try {
    assert.equal(appEnabled(), false);
    assert.equal(extEnabled(), false);
    const a = await sendAppMessage("zhangsan", "hello");
    const b = await sendExternalMessage("ext_1", "hello");
    assert.equal(a.skipped, true);
    assert.equal(b.skipped, true);
    assert.equal(f.calls.length, 0, "不该发起网络请求");
  } finally {
    f.restore();
  }
});

test("仅配了企业ID+应用Secret+AgentId 时, 家长通道仍为关闭", async () => {
  const env = creds("half");
  delete env.WECHAT_EXTCONTACT_SECRET;
  const restore = withEnv(env);
  try {
    assert.equal(appEnabled(), true);
    assert.equal(extEnabled(), false, "缺 EXTCONTACT_SECRET 时家长通道应关闭");
  } finally {
    restore();
  }
});

test("应用消息: 先取 token 再按企微结构发送", async () => {
  const restore = withEnv(creds("appmsg"));
  const f = stubFetch((url) =>
    url.includes("gettoken") ? TOKEN_OK : { errcode: 0, errmsg: "ok" },
  );
  try {
    const r = await sendAppMessage("zhangsan", "上课提醒");
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls[0].url.includes("/cgi-bin/gettoken"));
    assert.ok(f.calls[1].url.includes("/cgi-bin/message/send"));
    assert.ok(f.calls[1].url.includes("access_token=TOKEN_1"));
    assert.deepEqual(f.calls[1].body, {
      touser: "zhangsan",
      msgtype: "text",
      agentid: 1000002,
      text: { content: "上课提醒" },
    });
  } finally {
    f.restore();
    restore();
  }
});

test("客户联系消息: 按外部联系人结构发送", async () => {
  const restore = withEnv(creds("extmsg"));
  const f = stubFetch((url) => (url.includes("gettoken") ? TOKEN_OK : { errcode: 0 }));
  try {
    const r = await sendExternalMessage("ext_parent_1", "续费提醒");
    assert.equal(r.ok, true);
    assert.ok(f.calls[1].url.includes("/cgi-bin/externalcontact/message/send"));
    assert.deepEqual(f.calls[1].body, {
      to_external_userid: ["ext_parent_1"],
      msgtype: "text",
      text: { content: "续费提醒" },
    });
  } finally {
    f.restore();
    restore();
  }
});

test("token 会被复用 (第二次发送不再取 token)", async () => {
  const restore = withEnv(creds("tokencache"));
  const f = stubFetch((url) => (url.includes("gettoken") ? TOKEN_OK : { errcode: 0 }));
  try {
    await sendAppMessage("u1", "first");
    await sendAppMessage("u2", "second");
    const tokenCalls = f.calls.filter((c) => c.url.includes("gettoken"));
    assert.equal(tokenCalls.length, 1, "token 应命中缓存");
    assert.equal(f.calls.filter((c) => c.url.includes("message/send")).length, 2);
  } finally {
    f.restore();
    restore();
  }
});

test("企微返回 errcode 非 0 时 ok=false 但不抛异常", async () => {
  const restore = withEnv(creds("errmsg"));
  const f = stubFetch((url) =>
    url.includes("gettoken") ? TOKEN_OK : { errcode: 82001, errmsg: "invalid user" },
  );
  try {
    const r = await sendAppMessage("nobody", "x");
    assert.equal(r.ok, false);
    assert.equal(r.errcode, 82001);
  } finally {
    f.restore();
    restore();
  }
});

test("取 token 失败时不抛异常, 返回 ok=false", async () => {
  const restore = withEnv(creds("tokenfail"));
  const f = stubFetch(() => ({ errcode: 40013, errmsg: "invalid corpid" }));
  try {
    const r = await sendAppMessage("u1", "x");
    assert.equal(r.ok, false);
    assert.ok(r.error, "应带错误信息");
    assert.match(r.error, /invalid corpid/);
  } finally {
    f.restore();
    restore();
  }
});

test("fetch 抛错时被捕获 (不影响主流程)", async () => {
  const restore = withEnv(creds("networkdown"));
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const r = await sendAppMessage("u1", "x");
    assert.equal(r.ok, false);
    assert.match(r.error, /network down/);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("空的收件人直接跳过, 不发请求", async () => {
  const restore = withEnv(creds("norecipient"));
  const f = stubFetch(() => TOKEN_OK);
  try {
    const a = await sendAppMessage("", "x");
    const b = await sendExternalMessage(null, "x");
    assert.equal(a.skipped, true);
    assert.equal(b.skipped, true);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
    restore();
  }
});

test("runBatch 按上限截断 (子请求预算)", async () => {
  const jobs = Array.from({ length: MAX_PUSH_PER_RUN + 7 }, () => Promise.resolve({ ok: true }));
  const r = await runBatch(jobs);
  assert.equal(r.attempted, MAX_PUSH_PER_RUN);
  assert.equal(r.truncated, 7);
  assert.equal(r.sent, MAX_PUSH_PER_RUN);
});

test("runBatch 统计跳过与失败", async () => {
  const r = await runBatch([
    Promise.resolve({ ok: true }),
    Promise.resolve({ ok: false, skipped: true }),
    Promise.resolve({ ok: false, error: "boom" }),
    Promise.reject(new Error("rejected")),
  ]);
  assert.equal(r.attempted, 4);
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.failed, 2);
});

test("文案与任务装配", async () => {
  assert.match(
    lessonContent({
      studentName: "小明",
      teacherName: "Alice",
      scheduledAt: "2026-09-21T10:00:00.000Z",
      meetingUrl: "https://m/1",
    }),
    /入会链接/,
  );
  assert.doesNotMatch(
    lessonContent({
      studentName: "小明",
      teacherName: "Alice",
      scheduledAt: "2026-09-21T10:00:00.000Z",
    }),
    /入会链接/,
    "没有 meetingUrl 时不应出现入会链接",
  );
  assert.match(
    renewalContent({ packageName: "20课时", balance: 2, total: 20, stage: "low" }),
    /剩余 2 小时/,
  );
  assert.match(
    renewalContent({
      packageName: "20课时",
      balance: 2,
      total: 20,
      expiresAt: "2026-10-01T00:00:00.000Z",
      stage: "expiring",
    }),
    /2026-10-01 到期/,
  );

  // 未配置凭证时任务仍会生成, 但执行结果为 skipped
  delete globalThis.__CLOUDFLARE_ENV;
  const lessonJobs = lessonReminderJobs({
    lesson: { studentName: "小明", teacherName: "Alice", scheduledAt: "2026-09-21T10:00:00.000Z" },
    teacherWecomId: "t_ext",
    parentWecomIds: ["p_ext"],
  });
  assert.equal(lessonJobs.length, 2, "老师 1 + 家长 1");
  const r = await runBatch(lessonJobs);
  assert.equal(r.skipped, 2);

  const rJobs = renewalJobs({
    alert: { packageName: "20课时", balance: 2, total: 20, stage: "low" },
    parentWecomIds: ["p1", null, "p2"],
  });
  assert.equal(rJobs.length, 2, "null 的家长应被过滤");
});

test("getWeComConfig 从 Worker env 读取并 trim", () => {
  const restore = withEnv({
    WECHAT_CORP_ID: "  ww1  ",
    WECHAT_CORP_SECRET: " s ",
    WECHAT_AGENT_ID: " 1 ",
  });
  try {
    const c = getWeComConfig();
    assert.equal(c.corpId, "ww1");
    assert.equal(c.appSecret, "s");
    assert.equal(c.agentId, "1");
  } finally {
    restore();
  }
});

// ---------- Tier 5: 事件触发的实时推送 (课堂反馈 / 改期 / 取消) ----------

const {
  classReportContent,
  lessonChangedContent,
  lessonCancelledContent,
  classReportJobs,
  lessonChangedJobs,
  lessonCancelledJobs,
  textToParentsJobs,
  textToStaffJobs,
} = require("../src/wecom.js");

test("classReportContent 包含 学员 + 老师 + summary", () => {
  const text = classReportContent({
    studentName: "小明",
    teacherName: "Alice",
    scheduledAt: "2026-09-21T10:00:00.000Z",
    durationMin: 60,
    summary: "今天学了颜色单词",
  });
  assert.match(text, /小明/);
  assert.match(text, /Alice/);
  assert.match(text, /颜色单词/);
  assert.match(text, /60 分钟/);
});

test("classReportContent summary 缺失时不报错", () => {
  const text = classReportContent({
    studentName: "小明",
    teacherName: null,
    scheduledAt: "2026-09-21T10:00:00.000Z",
    durationMin: 60,
  });
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /未填写/);
});

test("lessonChangedContent 包含 from + to", () => {
  const text = lessonChangedContent({
    studentName: "小明",
    fromAt: "2026-09-21T10:00:00.000Z",
    toAt: "2026-09-22T14:00:00.000Z",
  });
  assert.match(text, /小明/);
  assert.match(text, /从 .* 改到/);
});

test("lessonCancelledContent 包含 学员 + 时间", () => {
  const text = lessonCancelledContent({
    studentName: "小明",
    scheduledAt: "2026-09-21T10:00:00.000Z",
    durationMin: 60,
  });
  assert.match(text, /小明/);
  assert.match(text, /已取消/);
});

test("textToParentsJobs 过滤掉 null/空字符串", () => {
  const jobs = textToParentsJobs(["p1", null, "", "p2"], "hello");
  assert.equal(jobs.length, 2);
});

test("textToStaffJobs 过滤掉 null/空字符串", () => {
  const jobs = textToStaffJobs(["t1", null, "t2"], "hello");
  assert.equal(jobs.length, 2);
});

test("classReportJobs / lessonChangedJobs / lessonCancelledJobs 各生成 1 条 job (单家长)", () => {
  const a = classReportJobs({
    parentWecomIds: ["p1"],
    payload: {
      studentName: "x",
      teacherName: "y",
      scheduledAt: "2026-09-21T10:00:00.000Z",
      durationMin: 60,
      summary: "s",
    },
  });
  const b = lessonChangedJobs({
    parentWecomIds: ["p1"],
    payload: {
      studentName: "x",
      fromAt: "2026-09-21T10:00:00.000Z",
      toAt: "2026-09-22T10:00:00.000Z",
    },
  });
  const c = lessonCancelledJobs({
    parentWecomIds: ["p1"],
    payload: { studentName: "x", scheduledAt: "2026-09-21T10:00:00.000Z", durationMin: 60 },
  });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(c.length, 1);
});

test("事件触发的 wecom 推送: 凭证就绪时通过 extcontact 通道发送 (与定时同源)", async () => {
  const restore = withEnv(creds("evt"));
  const f = stubFetch((url) => (url.includes("gettoken") ? TOKEN_OK : { errcode: 0 }));
  try {
    const r = await runBatch(
      classReportJobs({
        parentWecomIds: ["ext_parent_x"],
        payload: {
          studentName: "小明",
          teacherName: "Alice",
          scheduledAt: "2026-09-21T10:00:00.000Z",
          durationMin: 60,
          summary: "今天学了颜色",
        },
      }),
    );
    assert.equal(r.sent, 1);
    assert.equal(r.failed, 0);
    // 与定时 reminder 走同一条 /externalcontact/message/send 通道 (路由唯一)
    const sendCall = f.calls.find((c) => c.url.includes("/externalcontact/message/send"));
    assert.ok(sendCall, "必须走 extcontact 通道");
    assert.match(sendCall.body.text.content, /小明/);
    assert.match(sendCall.body.text.content, /颜色/);
  } finally {
    f.restore();
    restore();
  }
});
