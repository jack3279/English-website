// 守卫: 「从 R2 读回」这一侧的恢复流程。
//
// 背景: 之前每天定时把核心表导进 R2, 但**没有任何读回通道** —— 备份没有恢复路径
// 就等于没有备份, 真出事只能手动翻 JSON。这里锁住四条不可退让的性质:
//
//   1. 只 INSERT 缺失行, 从不 UPDATE / DELETE 现存行(回滚会抹掉备份之后的新数据)
//   2. 默认 dry-run: 不显式声明就绝不写库
//   3. 导出失败或截断的表拒绝恢复，force 也不能绕过
//   4. 幂等: 同一份备份再恢复一次应该是 0 行
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResult, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const backups = withErrorHandler(require("../routes/backups.js"));
const scheduled = require("../src/scheduled.js");
const { mock } = require("node:test");

const ADMIN = { id: "admin-1", role: "admin", full_name: "Admin" };
const TEACHER = { id: "t-1", role: "teacher", full_name: "老师" };

function makeBucket(entries) {
  const store = new Map(entries.map((e) => [e.key, e.text]));
  return {
    async list({ prefix } = {}) {
      const objects = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((k) => ({
          key: k,
          size: store.get(k).length,
          uploaded: new Date("2026-09-21T00:00:00Z"),
        }));
      return { objects, truncated: false, cursor: null };
    },
    async get(key) {
      const text = store.get(key);
      if (text == null) return null;
      return {
        key,
        size: text.length,
        uploaded: new Date("2026-09-21T00:00:00Z"),
        async text() {
          return text;
        },
      };
    },
  };
}

function backupText({ tables = {}, manifest } = {}) {
  return JSON.stringify({ exported_at: "2026-09-21T18:30:00.000Z", manifest, tables });
}

function withEnv(bucket, fn) {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BACKUP_BUCKET: bucket,
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

test("列出备份: 只认 backup/ 前缀, 新的排前面", async () => {
  const bucket = makeBucket([
    { key: "backup/2026-09-19.json", text: "{}" },
    { key: "backup/2026-09-21.json", text: "{}" },
    { key: "tmp/junk.json", text: "{}" },
  ]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.bound, true);
    assert.deepEqual(
      captured.body.data.items.map((i) => i.date),
      ["2026-09-21", "2026-09-19"],
    );
  });
});

test("没绑 R2 时明确说未绑定, 不能假装「一份备份都没有」", async () => {
  await withEnv(null, async () => {
    const { req, res, captured } = call({ testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.body.data.bound, false);
    assert.match(captured.body.data.hint, /BACKUP_BUCKET/);
  });
});

test("概览标出 v2 与「备份里压根没有的表」", async () => {
  const text = backupText({
    tables: { students: [{ id: "a" }] },
    manifest: { students: { count: 1, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ url: "/2026-09-21", testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.data.version, "v2");
    // records 是课后反馈正文, 备份漏掉了就必须显出来, 不能静默
    assert.ok(captured.body.data.absent.includes("records"));
    assert.equal(captured.body.data.totals.rows, 1);
  });
});

test("比对算出「备份里有、库里没有」的行", async () => {
  const text = backupText({
    tables: { students: [{ id: "a" }, { id: "b" }] },
    manifest: { students: { count: 2, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [{ id: "a" }], error: null }); // 当前库只活着 a
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({
      url: "/2026-09-21/diff?table=students",
      testUser: ADMIN,
    });
    await backups(req, res);
    const row = captured.body.data.tables[0];
    assert.equal(row.table, "students");
    assert.equal(row.backupRows, 2);
    assert.equal(row.dbRows, 1);
    assert.equal(row.missing, 1);
    assert.equal(captured.body.data.totalMissing, 1);
  });
});

test("复合主键表按 (parent_id, student_id) 判定身份, 不认 id", async () => {
  const text = backupText({
    tables: {
      parent_student_links: [
        { parent_id: "p1", student_id: "s1", relation: "guardian" },
        { parent_id: "p1", student_id: "s2", relation: "guardian" },
      ],
    },
    manifest: { parent_student_links: { count: 2, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [{ parent_id: "p1", student_id: "s1" }], error: null });
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({
      url: "/2026-09-21/diff?table=parent_student_links",
      testUser: ADMIN,
    });
    await backups(req, res);
    assert.equal(captured.body.data.tables[0].missing, 1);
  });
});

test("默认 dry-run: 一行都不写", async () => {
  const text = backupText({
    tables: { students: [{ id: "a" }, { id: "b" }] },
    manifest: { students: { count: 2, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [{ id: "a" }], error: null });
  const f = stubFetch([]);
  try {
    await withEnv(bucket, async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/2026-09-21",
        body: { tables: ["students"] },
        testUser: ADMIN,
      });
      await backups(req, res);
      assert.equal(captured.statusCode, 200);
      assert.equal(captured.body.data.dryRun, true);
      assert.equal(captured.body.data.totalPlanned, 1);
      assert.equal(f.calls.length, 0, "dry-run 绝不能碰到数据库");
    });
  } finally {
    f.restore();
  }
});

test("真恢复: 只插入缺失的那一行, 且只写 POST(永不 UPDATE/DELETE)", async (t) => {
  t.mock.method(require("../lib/adminConfirmation.js"), "verify", async () => {});
  const text = backupText({
    tables: {
      students: [
        { id: "a", full_name: "保留" },
        { id: "b", full_name: "被误删" },
      ],
    },
    manifest: { students: { count: 2, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [{ id: "a" }], error: null });
  const f = stubFetch([{ id: "b" }]);
  try {
    await withEnv(bucket, async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/2026-09-21",
        body: { dryRun: false, tables: ["students"] },
        testUser: ADMIN,
      });
      await backups(req, res);
      assert.equal(captured.statusCode, 200);
      assert.equal(captured.body.data.dryRun, false);
      assert.equal(captured.body.data.inserted, 1);
      assert.match(captured.body.data.caveat, /auth\.users/);

      assert.equal(f.calls.length, 1);
      const [callReq] = f.calls;
      assert.equal(callReq.init.method, "POST");
      assert.ok(callReq.url.endsWith("/rest/v1/students"));
      const sent = JSON.parse(callReq.init.body);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].id, "b", "不能连带覆盖库里还活着的 a");
      for (const c of f.calls) {
        assert.notEqual(c.init.method, "PATCH", "恢复路径不允许修改现存行");
        assert.notEqual(c.init.method, "DELETE");
      }
    });
  } finally {
    f.restore();
  }
});

test("幂等: 同一份备份再恢复一次应该是 0 行", async (t) => {
  t.mock.method(require("../lib/adminConfirmation.js"), "verify", async () => {});
  const text = backupText({
    tables: { students: [{ id: "a" }, { id: "b" }] },
    manifest: { students: { count: 2, ok: true, truncated: false } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [{ id: "a" }, { id: "b" }], error: null }); // 上次已恢复
  const f = stubFetch([]);
  try {
    await withEnv(bucket, async () => {
      const { req, res, captured } = call({
        method: "POST",
        url: "/2026-09-21",
        body: { dryRun: false, tables: ["students"] },
        testUser: ADMIN,
      });
      await backups(req, res);
      assert.equal(captured.body.data.inserted, 0);
      assert.equal(captured.body.data.totalMissing ?? 0, 0);
      assert.equal(f.calls.length, 0);
    });
  } finally {
    f.restore();
  }
});

test("当时导出失败的表不能通过 force 绕过", async () => {
  const text = backupText({
    tables: { students: [] },
    manifest: { students: { count: 0, ok: false, error: "permission denied" } },
  });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  setMockResult({ data: [], error: null });

  await withEnv(bucket, async () => {
    const a = call({
      method: "POST",
      url: "/2026-09-21",
      body: { tables: ["students"] },
      testUser: ADMIN,
    });
    await backups(a.req, a.res);
    assert.equal(a.captured.body.data.tables[0].blocked, true);
    assert.match(a.captured.body.data.tables[0].reason, /拒绝恢复/);

    const b = call({
      method: "POST",
      url: "/2026-09-21",
      body: { tables: ["students"], force: true },
      testUser: ADMIN,
    });
    await backups(b.req, b.res);
    assert.equal(b.captured.body.data.tables[0].blocked, true);
    assert.equal(b.captured.body.data.tables[0].missing, 0);
  });
});

test("非管理员 403", async () => {
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text: backupText({}) }]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ testUser: TEACHER });
    await backups(req, res);
    assert.equal(captured.statusCode, 403);
  });
});

test("日期必须是 YYYY-MM-DD, 否则 400", async () => {
  const bucket = makeBucket([]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ url: "/..%2fetc%2fpasswd", testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.statusCode, 400);
  });
});

test("下载返回原文并带附件头", async () => {
  const text = backupText({ tables: { students: [{ id: "a" }] }, manifest: {} });
  const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ url: "/2026-09-21/download", testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.statusCode, 200);
    assert.match(captured.headers["content-disposition"] ?? "", /backup-2026-09-21\.json/);
    // download 是原始文件, 不走 {data} 包装 —— 直接落 R2 里那份 JSON
    assert.equal(captured.body.data, undefined);
    assert.equal(captured.body.tables.students.length, 1);
  });
});

test("新加密备份下载时不被服务端解密", async () => {
  const archiveApi = require("../lib/backupArchive.js");
  const archive = await archiveApi.create(
    {
      from() {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          async range() {
            return { data: [{ id: "secret-row" }], count: 1 };
          },
        };
      },
      auth: {
        admin: {
          async listUsers() {
            return { data: { users: [] } };
          },
        },
      },
    },
    {
      async list() {
        return { objects: [] };
      },
      async get() {
        return null;
      },
    },
  );
  await withEnv(null, async () => {
    const text = JSON.stringify(await archiveApi.packArchive(archive));
    const bucket = makeBucket([{ key: "backup/2026-09-21.json", text }]);
    globalThis.__CLOUDFLARE_ENV.BACKUP_BUCKET = bucket;
    const { req, res, captured } = call({ url: "/2026-09-21/download", testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.body.format, "encrypted-backup");
    assert.equal(JSON.stringify(captured.body).includes("secret-row"), false);
  });
});

test("latest 落到最近一份", async () => {
  const bucket = makeBucket([
    { key: "backup/2026-09-19.json", text: backupText({}) },
    { key: "backup/2026-09-21.json", text: backupText({}) },
  ]);
  await withEnv(bucket, async () => {
    const { req, res, captured } = call({ url: "/latest", testUser: ADMIN });
    await backups(req, res);
    assert.equal(captured.body.data.key, "backup/2026-09-21.json");
  });
});

// 守卫: 备份文件名必须按北京时间。
// 定时任务跑在北京 02:30, 那一刻 UTC 还是前一天 —— 用 UTC 取日期会把文件名写成
// 前一天, 于是「今天到底备份了没」永远在对账时对不上号。
test("备份文件名按北京时间: UTC 18:30 那次应写成次日的 key", async () => {
  setMockResult({ data: [{ id: "a" }], error: null });
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-21T18:30:05.000Z") });
  const puts = [];
  const env = {
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BACKUP_BUCKET: {
      async get() {
        return null;
      },
      async put(key, body) {
        puts.push({ key, body, bytes: body.length });
      },
    },
  };
  try {
    const res = await scheduled.backupToR2(env);
    assert.equal(res.key, "backup/2026-09-22.json");
    assert.equal(res.failed_tables, 0, "每张表都该导出成功");
    assert.equal(puts.length, 3);
    const daily = puts.find((p) => p.key === "backup/2026-09-22.json");
    assert.equal(JSON.parse(daily.body).format, "encrypted-backup");
  } finally {
    mock.timers.reset();
  }
});

test("某张表导出失败时要在 manifest 里记 ok:false, 不能静默写成空数组", async () => {
  setMockResult({ data: null, error: { message: "permission denied for table leads" } });
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-21T18:30:05.000Z") });
  let body = null;
  const env = {
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BACKUP_BUCKET: {
      async get() {
        return null;
      },
      async put(key, b) {
        if (/^backup\/\d{4}-\d{2}-\d{2}\.json$/.test(key)) body = b;
      },
    },
  };
  try {
    const res = await scheduled.backupToR2(env);
    assert.ok(res.failed_tables > 0, "失败表数量必须报出来, 不能假装成功");
    const envelope = JSON.parse(body);
    const parsed = (await require("../lib/backupArchive.js").openArchive(envelope)).archive;
    const bad = Object.entries(parsed.manifest).filter(([, m]) => m.ok === false);
    assert.ok(bad.length > 0);
    assert.match(String(bad[0][1].error), /permission denied/);
  } finally {
    mock.timers.reset();
  }
});
