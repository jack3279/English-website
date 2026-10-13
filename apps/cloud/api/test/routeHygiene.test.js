// 守卫: 路由层的「卫生」—— 这类问题不会让测试变红, 但会在生产里咬人。
//
// 三件事:
//   1. 写操作必须走 lib/rest.js。supabase-js 的 .update()/.delete() 在 Workers 上
//      静默 no-op(接口 200、数据没变), 而**手写 fetch** 又会跟 restPatch/restInsert 各维护
//      一套 header 与错误处理, 迟早长歪。之前 14 处收敛过一轮, 但 messages / finance /
//      notifications 里还留着三份手写版, 这里把它们钉住。
//   2. 日志必须走 lib/log.js。裸 console 没有 reqId, 出问题时没法跟响应头里的
//      x-request-id 对上, 等于白记。
//   3. 登录失败不得把 email 写进日志 —— 日志是运维可见的, 一串失败邮箱本身
//      就是撞库成果。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applyMiddleware } = require("./helpers.js");
const { setMockResult, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const ROUTES_DIR = path.join(__dirname, "..", "routes");
const LIB_DIR = path.join(__dirname, "..", "lib");

const authRoute = withErrorHandler(require("../routes/auth.js"));
const messages = withErrorHandler(require("../routes/messages.js"));
const notifications = withErrorHandler(require("../routes/notifications.js"));
const finance = withErrorHandler(require("../routes/finance.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };
const MSG_ID = "11111111-1111-1111-1111-111111111111";
const TEACHER_ID = "22222222-2222-2222-2222-222222222222";
const NID = "33333333-3333-3333-3333-333333333333";

// 允许手写 PostgREST 的白名单, 每条都得站得住:
//   lessons.js   —— 只读 fetchRaw(带注释说明为什么不用 supabase-js), 调用点全是 GET
//   adminSeed.js —— 一次性演示数据种子脚本, 不是线上请求路径
const RAW_ALLOW = new Set(["lessons.js", "adminSeed.js"]);
// 允许裸 console 的白名单: 种子脚本的操作者需要看到进度输出
const CONSOLE_ALLOW = new Set(["adminSeed.js"]);

function routeFiles() {
  return fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".js") && f !== "_middleware.js");
}

function libFiles() {
  return fs.readdirSync(LIB_DIR).filter((f) => f.endsWith(".js"));
}

// lib/rest.js 本身就是 raw PostgREST 的实现，必须豁免。
const LIB_RAW_ALLOW = new Set(["rest.js"]);
// lib/log.js 是日志出口，里面必然出现 console（它就是 console 的封装）。
const LIB_CONSOLE_ALLOW = new Set(["log.js"]);

function withEnv(fn) {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  return fn();
}

function call(opts = {}) {
  return applyMiddleware({
    method: "GET",
    headers: { authorization: "Bearer fake" },
    ...opts,
  });
}

function stubFetch(result = []) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test("routes 里不得手写 PostgREST(写操作必须走 lib/rest.js)", () => {
  const offenders = [];
  for (const f of routeFiles()) {
    if (RAW_ALLOW.has(f)) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, f), "utf8");
    // 只看代码行, 注释里提到 rest/v1 是在解释历史, 不算违规
    const hit = src
      .split("\n")
      .filter((l) => l.includes("rest/v1/") && !l.trim().startsWith("//")).length;
    if (hit > 0) offenders.push(`${f}(${hit} 处)`);
  }
  assert.deepEqual(offenders, [], `这些文件手写了 PostgREST, 应收敛到 lib/rest.js: ${offenders}`);
});

test("routes 里不得裸 console(日志要带 reqId)", () => {
  const offenders = [];
  for (const f of routeFiles()) {
    if (CONSOLE_ALLOW.has(f)) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, f), "utf8");
    const hit = src
      .split("\n")
      .filter((l) => /console\.(log|error|warn)\(/.test(l) && !l.trim().startsWith("//")).length;
    if (hit > 0) offenders.push(`${f}(${hit} 处)`);
  }
  assert.deepEqual(offenders, [], `这些文件绕过 lib/log.js: ${offenders}`);
});

// ⚠️ 守卫范围必须覆盖 lib/。
// 曾只扫 routes/，而 lib/sessions.js 用 supabase-js 的 .update() 写库 ——
// Workers 上它是静默 no-op，导致「远程登出」点了没反应、设备实际仍在线，
// 却因为 lib/ 不在扫描范围里长期没被抓到。
test("lib/ 里不得手写 PostgREST(写操作必须走 lib/rest.js)", () => {
  const offenders = [];
  for (const f of libFiles()) {
    if (LIB_RAW_ALLOW.has(f)) continue;
    const src = fs.readFileSync(path.join(LIB_DIR, f), "utf8");
    const hit = src
      .split("\n")
      .filter((l) => l.includes("rest/v1/") && !l.trim().startsWith("//")).length;
    if (hit > 0) offenders.push(`${f}(${hit} 处)`);
  }
  assert.deepEqual(offenders, [], `这些 lib 文件手写了 PostgREST, 应改用 rest.js 自身: ${offenders}`);
});

test("lib/ 里不得裸 console(日志要带 reqId)", () => {
  const offenders = [];
  for (const f of libFiles()) {
    if (LIB_CONSOLE_ALLOW.has(f)) continue;
    const src = fs.readFileSync(path.join(LIB_DIR, f), "utf8");
    const hit = src
      .split("\n")
      .filter((l) => /console\.(log|error|warn)\(/.test(l) && !l.trim().startsWith("//")).length;
    if (hit > 0) offenders.push(`${f}(${hit} 处)`);
  }
  assert.deepEqual(offenders, [], `这些 lib 文件绕过 log.js: ${offenders}`);
});

// supabase-js 的 .update()/.delete() 在 Workers 上静默 no-op —— 接口 200、数据没变。
// 只读（.select()）可以用，所以只禁写方法。
// 插入用 .insert() 是允许的（insert 不受影响），但仍需在白名单里逐个说明。
//
// 判定要点：必须**紧跟在 .from("table") 链式起点之后**才算 supabase 客户端的写方法，
// 否则会误报 crypto.createHash().update() / map.update() 这类同名方法。
test("routes 与 lib 里不得用 supabase-js 的 update/upsert 写库", () => {
  const offenders = [];
  const files = [
    ...routeFiles().map((f) => [path.join(ROUTES_DIR, f), `routes/${f}`]),
    ...libFiles().map((f) => [path.join(LIB_DIR, f), `lib/${f}`]),
  ];

  // 剔除注释行，但保留行号以便定位
  const codeOf = (src) =>
    src.split("\n").map((l, i) => {
      const t = l.trim();
      const isComment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
      return { text: isComment ? "" : l, line: i + 1 };
    });

  for (const [full, label] of files) {
    const rows = codeOf(fs.readFileSync(full, "utf8"));
    const chainStarts = rows.filter((r) => /\.from\(\s*["'`]/.test(r.text));
    for (const start of chainStarts) {
      const idx = rows.indexOf(start);
      // 从 .from( 往后最多看 12 行，链上的 .update()/.upsert() 必在此窗口内
      for (const r of rows.slice(idx, idx + 12)) {
        if (r !== start && /;\s*$/.test(r.text) && !/\.\w+\s*\(/.test(r.text)) break;
        const m = r.text.match(/\.\s*(update|upsert)\s*\(/);
        if (m) {
          offenders.push(`${label}:${r.line} .${m[1]}()（链自 ${start.line} 行）`);
          break;
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `这些地方用了 supabase-js 写库（在 Workers 上静默 no-op）:\n  ${offenders.join("\n  ")}`,
  );
});

test("登录失败时不把 email 写进日志", async () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (line) => warns.push(String(line));
  try {
    setMockResult({ data: null, error: { message: "Invalid login credentials", status: 400 } });
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/login",
        body: { email: "probe-target@example.com", password: "wrong-password" },
      });
      await authRoute(req, res);
      assert.equal(captured.statusCode, 401);
    });
  } finally {
    console.warn = orig;
  }
  const joined = warns.join("\n");
  assert.ok(joined.includes("login_failed"), "登录失败应当留一条结构化日志");
  assert.ok(
    !joined.includes("probe-target@example.com"),
    "登录日志里出现了 email —— 失败邮箱列表本身就是撞库成果, 不能留在生产日志",
  );
});

test("POST /messages/:id 标记已读走 restPatch(真的发出 PATCH)", async () => {
  setMockResult({ data: { id: MSG_ID, to_user: ADMIN.id, read_at: null }, error: null });
  const f = stubFetch([{ id: MSG_ID, read_at: "2026-09-21T00:00:00.000Z" }]);
  try {
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "PATCH",
        url: `/${MSG_ID}`,
        testUser: ADMIN,
      });
      await messages(req, res);
      assert.equal(captured.statusCode, 200);
    });
  } finally {
    f.restore();
  }
  const patch = f.calls.find((c) => c.init.method === "PATCH");
  assert.ok(patch, "必须真的发出 PATCH(否则就是那个静默 no-op 的老毛病)");
  assert.ok(patch.url.includes("/rest/v1/internal_messages"));
  assert.ok(patch.url.includes("to_user=eq."), "过滤条件要带上收件人作为第二重保险");
});

test("非 UUID 的消息 id 直接 404, 不拼进查询串", async () => {
  const f = stubFetch([]);
  try {
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "PATCH",
        url: "/x&or=(to_user.eq.other)",
        testUser: ADMIN,
      });
      await messages(req, res);
      assert.notEqual(captured.statusCode, 200);
    });
  } finally {
    f.restore();
  }
  assert.equal(f.calls.length, 0, "非法 id 不该触发任何数据库写入");
});

test("POST /notifications/read 走 restInsert 且带 ignore-duplicates", async () => {
  setMockResult({ data: [{ id: NID }], error: null });
  const f = stubFetch([]);
  try {
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/read",
        body: { ids: [NID] },
        testUser: ADMIN,
      });
      await notifications(req, res);
      assert.equal(captured.statusCode, 200);
    });
  } finally {
    f.restore();
  }
  const post = f.calls.find((c) => c.init.method === "POST");
  assert.ok(post, "已读标记必须真的写库");
  assert.ok(post.url.includes("/rest/v1/notification_reads"));
  // notification_reads 是复合主键, 重复标记要变成无操作而不是 409
  assert.match(post.init.headers.Prefer ?? "", /ignore-duplicates/);
});

test("POST /finance/payroll/rate 改老师单价走 restPatch", async () => {
  setMockResult({ data: [], error: null });
  const f = stubFetch([{ profile_id: TEACHER_ID, hourly_pay: 120 }]);
  try {
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/payroll/rate",
        body: { teacher_id: TEACHER_ID, hourly_pay: 120 },
        testUser: ADMIN,
      });
      await finance(req, res);
      assert.equal(captured.statusCode, 200);
      assert.equal(captured.body.data.updated, 1);
    });
  } finally {
    f.restore();
  }
  const patch = f.calls.find((c) => c.init.method === "PATCH");
  assert.ok(patch, "改单价必须真的发出 PATCH");
  assert.ok(patch.url.includes("/rest/v1/teachers"));
  assert.equal(JSON.parse(patch.init.body).hourly_pay, 120);
});

// 守卫: 改老师单价时「匹配到 0 行」必须报错, 不能返 200 updated:0。
// PostgREST 的 PATCH 打到不存在的行照样返回 200 —— 前端会弹「已更新」,
// 而单价其实一个字都没改。实测就是这么踩的: 传了 teachers.id 而不是 profile_id。
test("改老师单价匹配不到行时返回 404, 不假装成功", async () => {
  setMockResult({ data: [], error: null });
  const f = stubFetch([]); // PostgREST 匹配 0 行 -> 返回空数组
  try {
    await withEnv(async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/payroll/rate",
        body: { teacher_id: TEACHER_ID, hourly_pay: 100 },
        testUser: ADMIN,
      });
      await finance(req, res);
      assert.equal(captured.statusCode, 404, "0 行更新必须报错, 否则是假成功");
      assert.match(captured.body.error, /profile_id/);
    });
  } finally {
    f.restore();
  }
});
