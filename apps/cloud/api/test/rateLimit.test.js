// 守卫: 公开接口的限流。
//
// B 版此前完全没有限流, 而 POST /leads 是无需登录的公开入口 —— 被脚本刷一下
// 就是几千条垃圾线索, 教务每天要看的线索列表直接报废。/auth/login 同理。
//
// 另外守住一条容易回归的: Workers 的 makeRes 原来 writableEnded 恒为 false,
// 中间件就算写了 429 也会被继续丢给业务 handler 覆盖掉。这里断言「确实短路了」。
const test = require("node:test");
const assert = require("node:assert/strict");
const rateLimit = require("../lib/rateLimit.js");
const middleware = require("../routes/_middleware.js");

function mockRes() {
  const c = { statusCode: 200, headers: {}, body: null, writableEnded: false };
  return {
    _captured: c,
    setHeader(k, v) {
      c.headers[String(k).toLowerCase()] = v;
    },
    status(s) {
      c.statusCode = s;
      return this;
    },
    json(b) {
      c.body = b;
      c.writableEnded = true;
      return this;
    },
    end() {
      c.writableEnded = true;
      return this;
    },
    headersSent: false,
  };
}

function reqFor(method, path, ip = "1.2.3.4") {
  return {
    method,
    url: "/",
    headers: { "cf-connecting-ip": ip },
    // worker.js 会把原始 Request 挂在这里; 路由分发前的完整路径只有它有
    _request: { url: `https://api.17say.org/api${path}` },
  };
}

async function run(method, path, ip) {
  const req = reqFor(method, path, ip);
  const res = mockRes();
  await middleware(req, res);
  return res._captured;
}

test.beforeEach(() => {
  rateLimit.reset();
  delete globalThis.__CLOUDFLARE_ENV;
});

test("POST /leads 超配额后返回 429 并短路", async () => {
  const limit = rateLimit.RULES.find((r) => r.name === "leads").limit;
  for (let i = 0; i < limit; i++) {
    const c = await run("POST", "/leads");
    assert.equal(c.statusCode, 200, `第 ${i + 1} 次不该被限`);
  }
  const blocked = await run("POST", "/leads");
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");
  assert.equal(blocked.writableEnded, true, "必须短路, 否则会被业务 handler 覆盖");
  assert.ok(Number(blocked.headers["retry-after"]) > 0, "要给 Retry-After, 客户端才知道等多久");
});

test("不同 IP 互不影响", async () => {
  const limit = rateLimit.RULES.find((r) => r.name === "leads").limit;
  for (let i = 0; i < limit; i++) await run("POST", "/leads", "1.1.1.1");
  assert.equal((await run("POST", "/leads", "1.1.1.1")).statusCode, 429);
  // 教室里多位家长共用一个出口网关也不至于互相连坐到 20, 但不同出口必须独立
  assert.equal((await run("POST", "/leads", "2.2.2.2")).statusCode, 200);
});

test("登录接口限流更严格", async () => {
  const rule = rateLimit.RULES.find((r) => r.name === "login");
  for (let i = 0; i < rule.limit; i++) {
    assert.equal((await run("POST", "/auth/login")).statusCode, 200);
  }
  const blocked = await run("POST", "/auth/login");
  assert.equal(blocked.statusCode, 429, "撞密码必须挡住");
  assert.match(blocked.body.error, /登录/);
});

test("不在规则表里的接口不受影响", async () => {
  for (let i = 0; i < 50; i++) {
    assert.equal((await run("POST", "/messages")).statusCode, 200, "登录用户发的站内信不该被限");
  }
  assert.equal((await run("GET", "/leads")).statusCode, 200, "GET 不写库, 不限");
});

test("RATE_LIMIT_DISABLED=1 可整体关闭（压测/演示用）", async () => {
  globalThis.__CLOUDFLARE_ENV = { RATE_LIMIT_DISABLED: "1" };
  const limit = rateLimit.RULES.find((r) => r.name === "leads").limit;
  for (let i = 0; i < limit + 5; i++) {
    assert.equal((await run("POST", "/leads")).statusCode, 200);
  }
});

test("取不到 IP 时归到同一桶, 不会因为 undefined 绕过", async () => {
  const limit = rateLimit.RULES.find((r) => r.name === "leads").limit;
  const bare = () => ({
    method: "POST",
    url: "/",
    headers: {},
    _request: { url: "https://x/api/leads" },
  });
  for (let i = 0; i < limit; i++) {
    const res = mockRes();
    await middleware(bare(), res);
    assert.equal(res._captured.statusCode, 200);
  }
  const res = mockRes();
  await middleware(bare(), res);
  assert.equal(res._captured.statusCode, 429, "匿名请求也要限, 否则换个头就绕过了");
});
