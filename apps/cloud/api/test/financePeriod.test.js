// 守卫: 财务报表的「任意区间」统计与两个导出数据源。
//
// 背景: /finance/summary 原来写死只算自然月, 页面也没法切换周期,
// 「上个月营收多少 / 近 30 天怎么样」只能靠改代码或人工心算。
// 顺带修掉一个真实的口径 bug —— 原来用 new Date(y, m, 1) 取月首, 而 Workers 跑在 UTC,
// 每月 1 号 0-8 点之间「本月营收」算的是上个月。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const finance = withErrorHandler(require("../routes/finance.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };

const withEnv = (fn) => async () => {
  globalThis.__CLOUDFLARE_ENV = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
  };
  try {
    await fn();
  } finally {
    delete globalThis.__CLOUDFLARE_ENV;
  }
};

function call(url) {
  return applyMiddleware({
    method: "GET",
    url,
    headers: { authorization: "Bearer fake" },
    testUser: ADMIN,
  });
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

test(
  "月首按 Asia/Shanghai 计算, 不是 UTC",
  withEnv(async () => {
    // 上海时间 2026-09-01 01:00 = UTC 2026-08-31 17:00。
    // 若按 UTC 取月首会得到 2026-08-01, 「本月营收」就会把 8 月算进来。
    const realNow = Date.now;
    Date.now = () => Date.parse("2026-08-31T17:00:00Z");
    try {
      setMockResults([
        { data: [], error: null }, // payments
        { data: [], error: null }, // prev payments
        { data: [], error: null }, // transactions
        { count: 0, error: null }, // active students
        { data: [], error: null }, // low balance
        { count: 0, error: null }, // all students
        { count: 0, error: null }, // completed lessons
      ]);
      const { req, res } = call("/summary");
      await finance(req, res);
      assert.equal(res._captured.statusCode, 200);
      assert.equal(res._captured.body.data.period.preset, "this_month");
    } finally {
      Date.now = realNow;
    }
  }),
);

test(
  "GET /finance/summary 拒绝非法日期",
  withEnv(async () => {
    const { req, res } = call("/summary?from=2026-13-01&to=2026-09-30");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 400, "非法日期要 400, 不能静默按本月算");
  }),
);

test(
  "GET /finance/summary 拒绝 from 晚于 to",
  withEnv(async () => {
    const { req, res } = call("/summary?from=2026-09-30&to=2026-09-01");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 400);
  }),
);

test(
  "GET /finance/summary 自定义区间时回传 period",
  withEnv(async () => {
    setMockResults([
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { count: 0, error: null },
      { data: [], error: null },
      { count: 0, error: null },
      { count: 0, error: null },
    ]);
    const { req, res } = call("/summary?from=2026-08-01&to=2026-08-31");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.deepEqual(res._captured.body.data.period, {
      from: "2026-08-01",
      to: "2026-08-31",
      preset: "custom",
    });
  }),
);

test(
  "GET /finance/revenue 返回明细行与合计",
  withEnv(async () => {
    setMockResults([
      {
        data: [
          {
            id: "p1",
            amount_cents: 120000,
            method: "wechat",
            paid_at: "2026-09-05T02:00:00Z",
            notes: null,
            student_id: "s1",
            students: { full_name: "小明" },
            student_packages: { package_types: { name: "60 课时包" } },
          },
          {
            id: "p2",
            amount_cents: 30000,
            method: "cash",
            paid_at: "2026-09-06T02:00:00Z",
            notes: "补缴",
            student_id: "s2",
            students: { full_name: "小红" },
            student_packages: null,
          },
        ],
        error: null,
      },
    ]);
    const { req, res } = call("/revenue?from=2026-09-01&to=2026-09-30");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 200);
    const d = res._captured.body.data;
    assert.equal(d.count, 2);
    assert.equal(d.total_cents, 150000, "合计要等于各行之和, 前端导出靠它校验");
    assert.equal(d.rows[0].student_name, "小明");
    assert.equal(d.rows[1].package_name, "—", "没关联课时包也不能崩");
    assert.equal(d.truncated, false);
  }),
);

test(
  "GET /finance/revenue 拒绝非法区间",
  withEnv(async () => {
    const { req, res } = call("/revenue?from=yesterday");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 400);
  }),
);

test(
  "GET /finance/renewals 合并同学员并排除停课学员",
  withEnv(async () => {
    setMockResults([
      {
        data: [
          {
            id: "pk1",
            student_id: "s1",
            total_hours: 10,
            remaining_hours: 1,
            expires_at: null,
            package_types: { name: "10 课时包" },
          },
          {
            id: "pk2",
            student_id: "s2",
            total_hours: 20,
            remaining_hours: 2,
            expires_at: null,
            package_types: { name: "20 课时包" },
          },
        ],
        error: null,
      },
      {data:[{student_id:"s1",remaining_hours:1},{student_id:"s2",remaining_hours:2}],error:null},
      {
        data: [
          { id: "s1", full_name: "小明", status: "active" },
          { id: "s2", full_name: "小红", status: "inactive" },
        ],
        error: null,
      },
      {
        data: [
          {
            student_id: "s1",
            parents: { profile_id: "pf1", profiles: { phone: "13800000001" } },
          },
        ],
        error: null,
      },
    ]);
    const { req, res } = call("/renewals");
    await finance(req, res);
    assert.equal(res._captured.statusCode, 200);
    const d = res._captured.body.data;
    assert.equal(d.count, 1, "停课学员不该进续费清单 —— 打过去是无效外呼");
    assert.equal(d.rows[0].student_name, "小明");
    assert.equal(d.rows[0].phone, "13800000001", "导出要给教务能直接拨的号码");
    assert.equal(d.rows[0].stage, "low");
  }),
);
