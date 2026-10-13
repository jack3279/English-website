// 守卫: 课后反馈(课堂报告)与运营任务中心。
//
// 背景: 这两块此前在 B 版完全是空的 ——
//   · 老师写了课后反馈(content/表现/作业), 家长端只能看到一行拼好的 summary,
//     管理员则**根本没有**查看课后反馈的入口, 教学质量无从抽查。
//   · 教务每天要挨个点开 6 个页面才知道今天有没有活干。
//
// 关键口径: 所有课程都是一对一, 所以「班级报告」= 单个学员某一节课的反馈,
// 不存在按班聚合。管理员能看**未发布**的草稿, 家长只能看已发布的。
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("./helpers.js");
const { setMockResults, resetMock, getQueryLog } = require("./setup.js");
const { withErrorHandler } = require("../lib/errors.js");

const reports = withErrorHandler(require("../routes/reports.js"));
const operations = withErrorHandler(require("../routes/operations.js"));

const ADMIN = { id: "00000000-0000-0000-0000-000000000001", role: "admin", full_name: "Admin" };
const TEACHER = { id: "00000000-0000-0000-0000-000000000002", role: "teacher", full_name: "T" };

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

function call(url, user = ADMIN) {
  return applyMiddleware({
    method: "GET",
    url,
    headers: { authorization: "Bearer fake" },
    testUser: user,
  });
}

test.afterEach(() => {
  resetMock();
  delete globalThis.__CLOUDFLARE_ENV;
});

// ── 课堂报告 ────────────────────────────────────────────────

test(
  "GET /reports 带出分栏内容与发布标记",
  withEnv(async () => {
    setMockResults([
      {
        // records + 嵌入的 lessons
        data: [
          {
            id: "rec1",
            lesson_id: "les1",
            content: "自然拼读 Unit 3",
            performance: "专注度好",
            homework: "复习 10 个单词",
            next_plan: "下周进入 Unit 4",
            created_at: "2026-09-20T10:00:00Z",
            created_by: "t1",
            lessons: {
              id: "les1",
              scheduled_at: "2026-09-20T02:00:00Z",
              duration_min: 60,
              student_id: "s1",
              teacher_id: "t1",
              status: "completed",
            },
            parent_feeds: [{ id: "pf1" }],
          },
          {
            id: "rec2",
            lesson_id: "les2",
            content: "口语练习",
            performance: null,
            homework: null,
            next_plan: null,
            created_at: "2026-09-19T10:00:00Z",
            created_by: "t1",
            lessons: {
              id: "les2",
              scheduled_at: "2026-09-19T02:00:00Z",
              duration_min: 30,
              student_id: "s2",
              teacher_id: "t1",
              status: "completed",
            },
            parent_feeds: [],
          },
        ],
        count: 2,
        error: null,
      },
      // published count
      { data: null, count: 1, error: null },
      // students
      {
        data: [
          { id: "s1", full_name: "小明" },
          { id: "s2", full_name: "小红" },
        ],
        error: null,
      },
      // profiles (老师 + 作者)
      { data: [{ id: "t1", full_name: "Anna" }], error: null },
    ]);

    const { req, res } = call("/?pageSize=20");
    await reports(req, res);
    assert.equal(res._captured.statusCode, 200);
    const rows = res._captured.body.data;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].student_name, "小明");
    assert.equal(rows[0].teacher_name, "Anna");
    assert.equal(rows[0].performance, "专注度好", "分栏字段必须透出, 不能只剩 summary");
    assert.equal(rows[0].next_plan, "下周进入 Unit 4");
    assert.equal(rows[0].published, true);
    assert.equal(rows[1].published, false, "没进 parent_feeds 的就是草稿");
    assert.equal(rows[1].performance, "", "空字段要给空串而不是 null, 前端直接渲染不炸");
    assert.equal(res._captured.body.meta.publishedCount, 1);
  }),
);

test(
  "GET /reports?published=no 在数据库分页前排除已发布反馈",
  withEnv(async () => {
    setMockResults([
      { data: [], count: 7, error: null },
      { data: null, count: 13, error: null },
    ]);
    const { req, res } = call("/?published=no&page=2&pageSize=10");
    await reports(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.length, 0, "当前页由数据库过滤后的草稿构成");
    assert.equal(res._captured.body.meta.total, 7, "total 必须是草稿总数，不能是全量记录数");
    assert.equal(res._captured.body.meta.publishedCount, 13, "publishedCount 必须独立统计全量已发布数");

    const listQuery = getQueryLog().filter((q) => q.table === "records")[0];
    assert.ok(listQuery.ops.some((op) => op.op === "is" && op.args[0] === "parent_feeds.id"));
    assert.deepEqual(
      listQuery.ops.find((op) => op.op === "range").args,
      [10, 19],
      "必须先下推发布状态，再取第二页",
    );
  }),
);

test(
  "GET /reports?published=yes 使用 inner embed 只查询已发布反馈",
  withEnv(async () => {
    setMockResults([
      { data: [], count: 0, error: null },
      { data: null, count: 0, error: null },
    ]);
    const { req, res } = call("/?published=yes");
    await reports(req, res);
    assert.equal(res._captured.statusCode, 200);
    const listQuery = getQueryLog().filter((q) => q.table === "records")[0];
    const selectArg = listQuery.ops.find((op) => op.op === "select").args[0];
    assert.match(selectArg, /parent_feeds!inner\(id\)/);
    assert.equal(
      listQuery.ops.some((op) => op.op === "is"),
      false,
      "yes 口径应靠 inner join 下推，而不是取回页面后内存过滤",
    );
  }),
);

test('报告已发布数量保留课节关联，以便同时应用教师及日期过滤', withEnv(async () => {
  setMockResults([{ data: [], count: 0, error: null }, { data: null, count: 0, error: null }]);
  const { req, res } = call('/?from=2026-10-01&to=2026-10-31', TEACHER);
  await reports(req, res);
  assert.equal(res._captured.statusCode, 200);
  const query = getQueryLog().filter(q => q.table === 'records')[1];
  const selection = query.ops.find(op => op.op === 'select').args[0];
  assert.match(selection, /lessons:lesson_id!inner/);
  assert.match(selection, /parent_feeds!inner/);
  assert(!selection.includes('parent_feeds:record_id'));
  assert(query.ops.some(op => op.op === 'eq' && op.args[0] === 'lessons.teacher_id'));
  assert(query.ops.some(op => op.op === 'gte' && op.args[0] === 'lessons.scheduled_at'));
}));

test(
  "GET /reports 拒绝非法 published 参数",
  withEnv(async () => {
    const { req, res } = call("/?published=maybe");
    await reports(req, res);
    assert.equal(res._captured.statusCode, 400);
  }),
);

test(
  "GET /reports 拒绝非法日期区间",
  withEnv(async () => {
    const { req, res } = call("/?from=2026-13-01&to=2026-09-30");
    await reports(req, res);
    assert.equal(res._captured.statusCode, 400, "非法日期要 400, 不能静默忽略");
  }),
);

test(
  "家长不能访问 /reports —— 未发布的草稿不能让家长看到",
  withEnv(async () => {
    const PARENT = { id: "p1", role: "parent", full_name: "P" };
    const { req, res } = call("/", PARENT);
    await reports(req, res);
    assert.equal(res._captured.statusCode, 403, "家长只能走 /parent/feeds(只含已发布)");
  }),
);

test("教师不能读取全机构课节统计和教师绩效排名", async () => {
  for (const path of ["/lesson-stats", "/teacher-attendance"]) {
    const { req, res } = call(path, TEACHER);
    await reports(req, res);
    assert.equal(res._captured.statusCode, 403, `${path} 应仅管理员可访问`);
  }
});

// ── 运营任务中心 ─────────────────────────────────────────────

function mockOps(user = ADMIN, {
  leave = [],
  makeup = [],
  leads = [],
  overdue = [],
  completed = [],
  packs = [],
  balances = [],
  balanceRows = [],
  records = [],
  students = [],
  pendingReview = [],
} = {}) {
  const admin = user.role === "admin";
  const results = [];
  if (!admin) {
    results.push({ data: [], error: null });
    results.push({ data: [], error: null });
  }
  results.push(
    { data: leave, error: null },
    { data: makeup, error: null },
    { data: overdue, error: null },
    { data: completed, error: null },
  );
  if (admin) results.push({ data: leads, error: null });
  if (admin) results.push({ data: packs, error: null });
  if (admin) results.push({ data: balanceRows, error: null });
  if (completed.length) results.push({ data: records, error: null });
  const activePacks = packs.filter((p) => p.students?.status !== "inactive");
  if (admin && activePacks.length) results.push({ data: balances, error: null });
  const hasNames =
    [...leave, ...makeup, ...overdue, ...completed].length ||
    balanceRows.length ||
    activePacks.some((p) => balances.some((b) => b.student_id === p.student_id));
  if (hasNames) results.push({ data: students, error: null });
  if (admin) results.push({ data: pendingReview, count: pendingReview.length, error: null });
  setMockResults(results);
}

test(
  "GET /operations 聚合成待办清单并算出合计",
  withEnv(async () => {
    mockOps(ADMIN, {
      leave: [
        {
          id: "lv1",
          student_id: "s1",
          reason: "生病",
          created_at: "2026-09-20T01:00:00Z",
          lesson_id: "l1",
        },
      ],
      makeup: [
        {
          id: "mk1",
          student_id: "s2",
          created_at: "2026-09-19T01:00:00Z",
          original_lesson_id: "l2",
        },
      ],
      leads: [
        {
          id: "ld1",
          parent_name: "王女士",
          parent_phone: "13800000001",
          child_name: "小宝",
          intended_course: "少儿口语",
          trial_date: null,
          created_at: "2026-09-21T01:00:00Z",
        },
      ],
      overdue: [
        {
          id: "l3",
          student_id: "s3",
          teacher_id: "t1",
          scheduled_at: "2026-09-20T02:00:00Z",
          duration_min: 60,
        },
      ],
      completed: [
        {
          id: "l4",
          student_id: "s1",
          teacher_id: "t1",
          scheduled_at: "2026-09-19T02:00:00Z",
          completed_at: "2026-09-19T03:00:00Z",
        },
        {
          id: "l5",
          student_id: "s2",
          teacher_id: "t1",
          scheduled_at: "2026-09-19T04:00:00Z",
          completed_at: "2026-09-19T05:00:00Z",
        },
      ],
      records: [{ lesson_id: "l4" }], // l5 没写反馈
      students: [
        { id: "s1", full_name: "小明" },
        { id: "s2", full_name: "小红" },
        { id: "s3", full_name: "小刚" },
      ],
    });

    const { req, res } = call("/");
    await operations(req, res);
    assert.equal(res._captured.statusCode, 200);
    const body = res._captured.body.data;
    const byKey = Object.fromEntries(body.groups.map((g) => [g.key, g]));

    assert.equal(byKey.pending_leave.count, 1);
    assert.equal(byKey.pending_leave.items[0].name, "小明");
    assert.equal(byKey.pending_makeup.count, 1);
    assert.equal(byKey.new_lead.count, 1, "管理员要能看到新线索");
    assert.equal(byKey.overdue_lesson.count, 1);
    assert.equal(byKey.missing_feedback.count, 1, "l5 完课但没写反馈, 必须被挑出来");
    assert.equal(byKey.missing_feedback.items[0].name, "小红");
    assert.equal(body.summary.total, 5, "1+1+1+1+1 = 待办总数");
    assert.ok(body.summary.danger >= 2, "待审批请假与新线索是 danger");
  }),
);

test(
  "GET /operations 完课未写反馈用差集算, 不靠前端过滤",
  withEnv(async () => {
    mockOps(ADMIN, {
      completed: [
        {
          id: "l1",
          student_id: "s1",
          teacher_id: "t1",
          scheduled_at: "2026-09-19T02:00:00Z",
          completed_at: "2026-09-19T03:00:00Z",
        },
      ],
      records: [{ lesson_id: "l1" }],
      students: [{ id: "s1", full_name: "小明" }],
    });
    const { req, res } = call("/");
    await operations(req, res);
    assert.equal(res._captured.statusCode, 200);
    const body = res._captured.body.data;
    assert.equal(body.groups.find((g) => g.key === "missing_feedback").count, 0);
    assert.equal(body.summary.total, 0, "全部清空时 total 要为 0, 前端据此显示「今天没待办」");
  }),
);

test(
  "老师看不到线索组 —— 线索里含家长手机号",
  withEnv(async () => {
    mockOps(TEACHER, {
      leads: [
        {
          id: "ld1",
          parent_name: "王女士",
          parent_phone: "13800000001",
          child_name: "小宝",
          intended_course: null,
          trial_date: null,
          created_at: "2026-09-21T01:00:00Z",
        },
      ],
    });
    const { req, res } = call("/", TEACHER);
    await operations(req, res);
    assert.equal(res._captured.statusCode, 200);
    const body = res._captured.body.data;
    const forbiddenKeys = [
      "new_lead",
      "renewal",
      "negative_balance",
      "absence_review",
    ];
    for (const key of forbiddenKeys) {
      assert.equal(
        body.groups.some((g) => g.key === key),
        false,
        `${key} 是管理员财务/线索信息，不能出现在老师运营中心`,
      );
    }
    const queriedTables = getQueryLog().map((q) => q.table);
    for (const table of ["leads", "student_packages", "student_balance"]) {
      assert.equal(
        queriedTables.includes(table),
        false,
        `老师请求不能查询 ${table}`,
      );
    }
  }),
);

test(
  "运营中心续费提醒以 student_balance 视图而不是课时包剩余字段为准",
  withEnv(async () => {
    const pack = {
      id: "pkg1",
      student_id: "s1",
      total_hours: 100,
      remaining_hours: 100,
      expires_at: null,
      purchased_at: "2026-09-01T00:00:00Z",
      students: { full_name: "小明", status: "active" },
    };
    mockOps(ADMIN, {
      packs: [pack],
      balances: [{ student_id: "s1", remaining_hours: 1 }],
      students: [{ id: "s1", full_name: "小明" }],
    });

    const { req, res } = call("/");
    await operations(req, res);
    assert.equal(res._captured.statusCode, 200);
    const renewal = res._captured.body.data.groups.find((g) => g.key === "renewal");
    assert.equal(renewal.count, 1);
    assert.equal(renewal.items[0].name, "小明");
    assert.equal(
      renewal.items[0].sub,
      "剩 1h",
      "课时包字段仍为 100h；只有采用 student_balance 的 1h 才会出现低余额提醒",
    );

    const balanceQueries = getQueryLog().filter((q) => q.table === "student_balance");
    assert.ok(balanceQueries.some((q) => q.ops.some((op) => op.op === "in")));
  }),
);

test(
  "空数据也要返回全部 8 个分组, 前端才知道是「清空」而不是加载失败",
  withEnv(async () => {
    mockOps(ADMIN, {});
    const { req, res } = call("/");
    await operations(req, res);
    assert.equal(res._captured.statusCode, 200);
    assert.equal(res._captured.body.data.groups.length, 8);
    assert.equal(res._captured.body.data.summary.openKinds, 0);
  }),
);
