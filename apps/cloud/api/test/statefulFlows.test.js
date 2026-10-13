const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
require("./setup.js");
const { generate, Bucket, uuid } = require("./support/statefulDb.js");
let db;
require.cache[require.resolve("../lib/supabase.js")] = {
  exports: { getAdmin: () => db.client(), createAuthClient: () => db.client() },
};
// Only the identity-provider password check is mocked. Business handlers, raw
// REST writes, encrypted storage, locks and calculation code remain real.
require.cache[require.resolve("../lib/adminConfirmation.js")] = {
  exports: {
    verify: async (req, pw) => {
      if (req.context.role !== "admin" || pw !== "MOCK-password") throw new Error("Not authorized");
    },
  },
};
const store = require("../lib/secureStore.js"),
  ledger = require("../lib/studentHourLedger.js"),
  payroll = require("../lib/payrollReport.js"),
  settlements = require("../lib/payrollPeriodSettlement.js"),
  makeup = require("../lib/makeupWorkflow.js");
const routes = {
  renewals: require("../routes/renewals.js"),
  lessons: require("../routes/lessons.js"),
  packages: require("../routes/packages.js"),
  parent: require("../routes/parent.js"),
  leave: require("../routes/leave.js"),
};
const originalFetch = globalThis.fetch;
const admin = { id: uuid(1), role: "admin" },
  parent = { id: uuid(300), role: "parent" },
  teacher = { id: uuid(100), role: "teacher" };
function reqFor(user) {
  return {
    context: { userId: user.id, role: user.role, jwt: "mock-jwt" },
    reqId: "stateful-mock",
    headers: { authorization: "Bearer mock-jwt" },
    __testUser: user,
  };
}
async function call(route, user, url, method = "GET", body = {}) {
  const req = { ...reqFor(user), url, method, body };
  let status = 200,
    payload;
  await routes[route](req, {
    status(n) {
      status = n;
      return this;
    },
    json(v) {
      payload = v;
      return this;
    },
    setHeader() {},
  });
  assert(status < 400, `${route} ${url}: ${status} ${JSON.stringify(payload)}`);
  return payload;
}
const completeBody = { content: "MOCK课堂已完成", publishToParent: true };
test("个人占用阻止排课和补课；教师时间设置不能覆盖已排课程", async () => {
  const availability = require("../lib/teacherAvailability.js"),
    route = require("../routes/teacherAvailability.js"),
    when = new Date(Date.now() + 4 * 86400000);
  when.setUTCHours(1, 0, 0, 0);
  const until = new Date(when.getTime() + 3600000).toISOString();
  await availability.save(teacher.id, {
    revision: 0,
    available: [],
    weeklyBusy: [],
    busy: [{ id: uuid(991001), from: when.toISOString(), to: until, note: "个人会议" }],
  });
  const scheduled = require("../routes/schedules.js"),
    req = {
      ...reqFor(admin),
      method: "POST",
      url: "/",
      body: {
        teacher_id: teacher.id,
        student_id: uuid(1000),
        scheduled_at: when.toISOString(),
        duration_min: 30,
      },
    },
    response = {
      status() {
        return this;
      },
      json() {},
    };
  await assert.rejects(() => scheduled(req, response), { code: "TEACHER_UNAVAILABLE" });
  const origin = lesson(0);
  origin.status = "cancelled";
  const m = await makeup.create(reqFor(parent), {
    student_id: origin.student_id,
    original_lesson_id: origin.id,
    note: "补课",
  });
  await assert.rejects(
    () =>
      makeup.schedule(reqFor(admin), m, {
        status: "scheduled",
        teacher_id: teacher.id,
        scheduled_at: when.toISOString(),
      }),
    { code: "TEACHER_UNAVAILABLE" },
  );
  const request = {
    ...reqFor({ id: uuid(101), role: "teacher" }),
    method: "GET",
    url: "/" + teacher.id,
  };
  await assert.rejects(() => route(request, response));
  await db
    .query("lessons")
    .insert({
      id: uuid(991002),
      teacher_id: teacher.id,
      student_id: origin.student_id,
      scheduled_at: new Date(when.getTime() + 86400000).toISOString(),
      duration_min: 60,
      status: "scheduled",
    });
  await assert.rejects(
    () =>
      route(
        {
          ...reqFor(teacher),
          method: "POST",
          url: "/" + teacher.id,
          body: {
            revision: 1,
            available: [],
            weeklyBusy: [],
            busy: [
              {
                id: uuid(991003),
                from: new Date(when.getTime() + 86400000).toISOString(),
                to: new Date(when.getTime() + 86400000 + 3600000).toISOString(),
              },
            ],
          },
        },
        response,
      ),
    { code: "BUSY_LESSON_CONFLICT" },
  );
});
test("缺勤点名记录写入中断后可恢复原内容，不重复扣课时", async () => {
  await require("../lib/institutionSettings.js").updateSettings({absenceDeductHours:true});
  const l = lesson(0),
    before = db.balance(l.student_id),
    body = {
      result: "no_show",
      content: "Unit 2 planned",
      reason: "未提前请假",
      deduct_hours: true,
    };
  db.failNext = "records";
  await assert.rejects(() => call("lessons", teacher, `/${l.id}/roll-call`, "POST", body));
  assert.equal(db.balance(l.student_id), before);
  assert.equal(l.status, "no_show");
  const detail = (await call("lessons", teacher, `/${l.id}`)).data;
  assert.equal(detail.roll_call.state, "pending");
  assert.equal(detail.roll_call.input.content, body.content);
  await call("lessons", teacher, `/${l.id}/roll-call`, "POST", body);
  assert.equal(db.balance(l.student_id), before);
  assert.equal(db.rows("records").filter((r) => r.lesson_id === l.id).length, 1);
});
test("新点名：上课、请假、缺勤均记录内容且不保存反馈；重复提交不重扣", async () => {
  for (const [index, result, deduct] of [
    [0, "attended", false],
    [1, "leave", false],
    [2, "no_show", false],
    [3, "no_show", true],
  ]) {
    const l = lesson(index),
      actor = { id: l.teacher_id, role: "teacher" },
      before = db.balance(l.student_id),
      body = { result, content: "Unit 2, pages 8-9", reason: "模拟考勤原因", deduct_hours: deduct };
    await require("../lib/institutionSettings.js").updateSettings({absenceDeductHours:deduct});
    if (result === 'leave') {
      const request = { id: uuid(99000+index), lesson_id: l.id, student_id: l.student_id, requested_by: actor.id, status: 'pending', reason: body.reason, created_at: new Date(Date.parse(l.scheduled_at)-3600000).toISOString() };
      db.rows('leave_requests').push(request);
      l.leave_status = 'pending';
      await require('../lib/leavePolicy.js').remember(request, l, 0, Date.parse(request.created_at));
    }
    await call("lessons", actor, `/${l.id}/roll-call`, "POST", body);
    await call("lessons", actor, `/${l.id}/roll-call`, "POST", body);
    const rec = db.rows("records").filter((r) => r.lesson_id === l.id);
    assert.equal(rec.length, 1);
    assert.equal(rec[0].content, body.content);
    assert.equal(rec[0].performance, "");
    assert.equal(rec[0].homework, "");
    assert.equal(
      db.balance(l.student_id),
      before - (result === "attended" ? l.duration_min / 60 : 0),
    );
    assert.equal(
      l.status,
      result === "attended" ? "completed" : result === "leave" ? "cancelled" : "no_show",
    );
    assert(db.rows("parent_feeds").some((f) => f.record_id === rec[0].id));
    await assert.rejects(
      () => call("lessons", actor, `/${l.id}/roll-call`, "POST", { ...body, content: "different" }),
      { code: "ROLL_CALL_CHANGED" },
    );
  }
});
test("点名必填内容且只允许本人教师，尚未下课不能登记上课", async () => {
  const l = lesson(0);
  await assert.rejects(
    () =>
      call("lessons", teacher, `/${l.id}/roll-call`, "POST", { result: "attended", content: " " }),
    { code: "ROLL_CALL_CONTENT" },
  );
  await assert.rejects(() =>
    call("lessons", { id: uuid(101), role: "teacher" }, `/${l.id}/roll-call`, "POST", {
      result: "attended",
      content: "Unit 1",
    }),
  );
  await assert.rejects(() =>
    call("lessons", parent, `/${l.id}/roll-call`, "POST", {
      result: "attended",
      content: "Unit 1",
    }),
  );
  l.scheduled_at = new Date(Date.now() + 86400000).toISOString();
  await assert.rejects(
    () =>
      call("lessons", teacher, `/${l.id}/roll-call`, "POST", {
        result: "attended",
        content: "Unit 1",
      }),
    { code: "CLASS_NOT_ENDED" },
  );
});
function lesson(i, j = 12) {
  return db.rows("lessons").find((l) => l.id === uuid(10000 + i * 20 + j));
}
const report = (user = admin, period = "monthly") =>
  payroll.report(
    reqFor(user),
    new URLSearchParams({ from: "2026-10-01", to: "2026-10-31", period }),
  );
test.beforeEach(() => {
  db = generate();
  globalThis.__CLOUDFLARE_ENV = {
    BACKUP_BUCKET: new Bucket(),
    ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
    SUPABASE_URL: "https://stateful.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "mock-only",
  };
  globalThis.fetch = (url, options) => db.fetch(url, options);
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__CLOUDFLARE_ENV;
});
test("大样本：1440条完课跨500行分页，周/月汇总与原始课程一致，教师只能看到本人课酬", async () => {
  const monthly = await report(),
    weekly = await report(admin, "weekly"),
    done = db.rows("lessons").filter((l) => l.status === "completed");
  assert.equal(monthly.details.length, 1440);
  assert.equal(weekly.details.length, 1440);
  const expected = {};
  for (const l of done) {
    const t = db.rows("teachers").find((t) => t.profile_id === l.teacher_id);
    expected[t.pay_currency] = (expected[t.pay_currency] || 0) + l.pay_amount;
  }
  assert.deepEqual(monthly.totals.by_currency, expected);
  assert.deepEqual(weekly.totals.by_currency, expected);
  assert(db.queries.some((q) => q.table === "lessons" && q.start === 1000));
  const mine = await report(teacher);
  assert.equal(mine.details.length, 120);
  assert(mine.details.every((l) => l.teacher_id === teacher.id && l.student_price === null));
  const balances = await Promise.all(db.rows("students").map((s) => ledger.build(s.id)));
  assert(balances.every((b) => b.remaining_hours === 88.75));
});
test("批量完课：36名学生、四种课时长度，课表/记录/家长反馈/余额/课酬同时联动，重试不重扣", async () => {
  const before = await report();
  let payDelta = { PHP: 0, USD: 0, EUR: 0 };
  for (let i = 0; i < 36; i++) {
    const l = lesson(i, i % 2 ? 13 : 12);
    l.duration_min = [30, 45, 60, 90][i % 4];
    const user = { id: l.teacher_id, role: "teacher" },
      balance = db.balance(l.student_id),
      count = db.rows("lesson_transactions").length;
    const response = await call("lessons", user, `/${l.id}/complete`, "POST", completeBody);
    assert.equal(response.data.newBalance, balance - l.duration_min / 60);
    assert.equal(l.status, "completed");
    assert.equal(db.rows("records").filter((r) => r.lesson_id === l.id).length, 1);
    const r = db.rows("records").find((r) => r.lesson_id === l.id);
    assert(
      db.rows("parent_feeds").some((f) => f.record_id === r.id && f.student_id === l.student_id),
    );
    await call("lessons", user, `/${l.id}/complete`, "POST", completeBody);
    assert.equal(db.rows("lesson_transactions").length, count + 1);
    assert.equal(db.balance(l.student_id), balance - l.duration_min / 60);
    const view = await ledger.build(l.student_id);
    assert.equal(view.remaining_hours, db.balance(l.student_id));
    assert(view.events.some((e) => e.lesson_id === l.id && e.kind === "consume"));
    const t = db.rows("teachers").find((t) => t.profile_id === l.teacher_id);
    payDelta[t.pay_currency] += l.pay_amount;
  }
  const after = await report();
  assert.equal(after.details.length, before.details.length + 36);
  for (const currency of Object.keys(payDelta))
    assert.equal(
      after.totals.by_currency[currency] - before.totals.by_currency[currency],
      payDelta[currency],
    );
  const feeds = await call("parent", parent, `/feeds?studentId=${uuid(1000)}&pageSize=50`);
  assert(feeds.data.some((f) => f.content === "MOCK课堂已完成"));
});
test("续费→到账→完课→退费：同一学员课时账单和学费净额逐步对账", async () => {
  const qr = "data:image/png;base64,aGVsbG8=";
  await store.change("private/renewals/config", {}, () => ({
    enabled: true,
    recipient: "MOCK收款人",
    qr,
  }));
  const sid = uuid(1000),
    before = db.balance(sid),
    cash = () =>
      db
        .rows("package_payments")
        .filter((p) => p.student_id === sid)
        .reduce((n, p) => n + p.amount_cents, 0),
    originalCash = cash();
  const order = {
    id: uuid(900000),
    student_id: sid,
    package_type_id: uuid(2),
    parent_id: parent.id,
    student_name: "MOCK学生1",
    package_name: "MOCK十课时",
    hours: 10,
    amount_cents: 80000,
    status: "pending",
    recipient: "MOCK",
    package_id: uuid(900100),
    payment_id: uuid(900101),
  };
  await store.change("private/renewals/orders", [], () => [order]);
  await store.change("private/renewals/assets/" + order.id, {}, () => ({ qr }));
  await call("renewals", parent, `/${order.id}/proof`, "POST", { proof: qr });
  assert.equal(db.balance(sid), before);
  assert.equal(cash(), originalCash);
  const confirm = {
    current_password: "MOCK-password",
    amount_cents: 80000,
    payment_reference: "MOCK-WECHAT-001",
  };
  await call("renewals", admin, `/${order.id}/confirm`, "POST", confirm);
  await call("renewals", admin, `/${order.id}/confirm`, "POST", confirm);
  assert.equal(db.balance(sid), before + 10);
  assert.equal(cash(), originalCash + 80000);
  const l = lesson(0);
  await call("lessons", teacher, `/${l.id}/complete`, "POST", completeBody);
  assert.equal(db.balance(sid), before + 9.5);
  await call("packages", admin, "/refund", "POST", {
    student_package_id: order.package_id,
    hours: 2,
    amount_cents: 16000,
    notes: "MOCK退还未使用课时",
    idempotency_key: uuid(900001),
  });
  assert.equal(db.balance(sid), before + 7.5);
  assert.equal(cash(), originalCash + 64000);
  const bill = await ledger.build(sid);
  assert.equal(bill.remaining_hours, before + 7.5);
  assert.equal(bill.summary.refunded_hours, 2);
  assert.equal(bill.summary.purchased_hours, 110);
});
test("缺席扣/不扣课时→申请补课→安排老师→完课，补课单与课表同一课程同步", async () => {
  const absence = require("../lib/absence.js");
  for (let i = 0; i < 8; i++) {
    const l = lesson(i),
      deduct = i % 2 === 0,
      before = db.balance(l.student_id),
      user = { id: l.teacher_id, role: "teacher" };
    await absence.register(reqFor(user), l, {
      deduct_hours: deduct,
      reason: deduct ? "MOCK未提前请假" : "MOCK不扣费",
    });
    await absence.register(reqFor(user), l, {
      deduct_hours: deduct,
      reason: deduct ? "MOCK未提前请假" : "MOCK不扣费",
    });
    assert.equal(db.balance(l.student_id), before - (deduct ? l.duration_min / 60 : 0));
    assert.equal(l.pay_amount, Number(db.rows("teachers").find(t=>t.profile_id===l.teacher_id).hourly_pay)*l.duration_min/60);
    const request = await makeup.create(reqFor({ id: uuid(300 + i), role: "parent" }), {
      student_id: l.student_id,
      original_lesson_id: l.id,
      note: "MOCK申请补课",
    });
    const future = new Date(Date.now() + (i + 3) * 86400000).toISOString();
    const arranged = await makeup.schedule(reqFor(admin), request, {
      status: "scheduled",
      teacher_id: l.teacher_id,
      scheduled_at: future,
    });
    const actual = db.rows("lessons").find((x) => x.id === arranged.makeup_lesson_id);
    assert.equal(actual.course_id, l.course_id);
    assert.equal(actual.student_id, l.student_id);
    await call("lessons", user, `/${actual.id}/complete`, "POST", completeBody);
    assert.equal(db.rows("makeups").find((x) => x.id === request.id).status, "done");
    assert.equal(
      db.balance(l.student_id),
      before - (deduct ? l.duration_min / 60 : 0) - actual.duration_min / 60,
    );
  }
});
test("指定学生课程费率快照联动课酬报表，变更默认费率不会重算已完课", async () => {
  const l = lesson(0),
    config = {
      teachers: {
        [teacher.id]: {
          hourly_pay: 999,
          currency: "USD",
          cycle: "weekly",
          rules: [
            {
              id: uuid(910000),
              student_id: l.student_id,
              course_id: l.course_id,
              hourly_pay: 480,
              currency: "PHP",
              student_price: 180,
              effective_from: "2026-01-01",
              active: true,
            },
          ],
        },
      },
    };
  await store.change("private/payroll-pricing/v1", {}, () => config);
  await call("lessons", teacher, `/${l.id}/complete`, "POST", completeBody);
  assert.equal(l.pay_amount, 240);
  const first = (await report()).details.find((x) => x.lesson_id === l.id);
  assert.equal(first.student_amount, 90);
  assert.equal(first.pay_currency, "PHP");
  config.teachers[teacher.id].rules[0].hourly_pay = 800;
  await store.change("private/payroll-pricing/v1", {}, () => config);
  assert.equal((await report()).details.find((x) => x.lesson_id === l.id).pay_amount, 240);
  const mine = (await report(teacher)).details.find((x) => x.lesson_id === l.id);
  assert.equal(mine.student_amount, null);
});
test("月结登记→重复登记→撤销，课酬账单课程列表一致，重叠周结被阻止", async () => {
  const row = (await report()).rows.find((r) => r.teacher_id === teacher.id),
    body = {
      teacher_id: teacher.id,
      period: "monthly",
      from: "2026-10-01",
      to: "2026-10-31",
      confirmed: true,
      current_password: "MOCK-password",
      expected_amount_cents: Math.round(row.pay_amount * 100),
      expected_currency: row.pay_currency,
    };
  const first = await settlements.save(reqFor(admin), body),
    again = await settlements.save(reqFor(admin), body);
  assert.equal(first.state, "paid");
  assert.deepEqual(again.lesson_ids, row.lesson_ids);
  const weekly = await payroll.report(
    reqFor(admin),
    new URLSearchParams({
      teacher_id: teacher.id,
      from: "2026-10-05",
      to: "2026-10-11",
      period: "weekly",
    }),
  );
  await assert.rejects(
    () =>
      settlements.save(reqFor(admin), {
        ...body,
        period: "weekly",
        from: "2026-10-05",
        to: "2026-10-11",
        expected_amount_cents: Math.round(weekly.rows[0].pay_amount * 100),
      }),
    { code: "PAYROLL_OVERLAP" },
  );
  assert.equal(
    (
      await settlements.save(reqFor(admin), {
        ...body,
        mode: "retract",
        note: "MOCK核对后撤销登记",
      })
    ).state,
    "retracted",
  );
});
test("导出可复现 mock 数据集，不含线上数据或密钥", () => {
  const output = path.resolve(__dirname, "../../../../output/mock-data");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "teaching-fixtures.json"),
    JSON.stringify(
      {
        generatedFor: "isolated tests only",
        counts: Object.fromEntries(Object.entries(db.tables).map(([k, v]) => [k, v.length])),
        tables: db.tables,
      },
      null,
      2,
    ),
  );
  assert.equal(db.rows("students").length, 120);
  assert.equal(db.rows("lessons").length, 1680);
});
test("两个管理员并发为同一课时包退费，两笔退款都应准确减少余额", async () => {
  db.readDelay = { table: "student_balance", ms: 100 };
  const sid = uuid(1000),
    before = db.balance(sid),
    body = {
      student_package_id: uuid(4000),
      hours: 10,
      amount_cents: 80000,
      notes: "MOCK并发退款",
    };
  const requests = [
    { ...body, idempotency_key: uuid(930000) },
    { ...body, idempotency_key: uuid(930001) },
  ];
  const results = await Promise.allSettled(
    requests.map((v) => call("packages", admin, "/refund", "POST", v)),
  );
  for (let i = 0; i < results.length; i++)
    if (results[i].status === "rejected") {
      assert.equal(results[i].reason.code, "WORKFLOW_BUSY");
      await call("packages", admin, "/refund", "POST", requests[i]);
    }
  assert.equal(db.balance(sid), before - 20, "两笔财务记录不能只减一次课时");
});
test("退款收款写入失败回滚课时包，完课扣课写入失败回滚课程记录", async () => {
  const sid = uuid(1000),
    before = db.balance(sid),
    payments = db.rows("package_payments").length;
  db.failNext = "package_payments";
  await assert.rejects(() =>
    call("packages", admin, "/refund", "POST", {
      student_package_id: uuid(4000),
      hours: 2,
      amount_cents: 16000,
      notes: "MOCK失败恢复",
    }),
  );
  assert.equal(db.balance(sid), before);
  assert.equal(db.rows("package_payments").length, payments);
  const l = lesson(0),
    records = db.rows("records").length;
  db.failNext = "lesson_transactions";
  await assert.rejects(() => call("lessons", teacher, `/${l.id}/complete`, "POST", completeBody));
  assert.equal(db.balance(sid), before);
  assert.equal(l.status, "scheduled");
  assert.equal(db.rows("records").length, records);
  await call("lessons", teacher, `/${l.id}/complete`, "POST", completeBody);
  assert.equal(db.balance(sid), before - 0.5);
});
test("请假申请→审批→取消原课→生成补课单→家长课表出现新课", async () => {
  const l = lesson(0),
    before = db.balance(l.student_id);
  l.scheduled_at = new Date(Date.now() + 3 * 86400000).toISOString();
  const requested = await call("leave", parent, "/", "POST", {
    student_id: l.student_id,
    lesson_id: l.id,
    reason: "MOCK出差请假",
  });
  assert.equal(l.leave_status, "pending");
  assert.equal(db.balance(l.student_id), before);
  const requestId = requested.data.id;
  await call("leave", admin, `/${requestId}/review`, "POST", {
    status: "approved",
    note: "MOCK批准",
  });
  assert.equal(l.status, "cancelled");
  assert.equal(db.rows("leave_requests").find((x) => x.id === requestId).status, "approved");
  const m = db.rows("makeups").find((x) => x.original_lesson_id === l.id);
  assert(m);
  assert.equal(db.balance(l.student_id), before);
  const scheduledAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const result = await makeup.schedule(reqFor(admin), m, {
    status: "scheduled",
    teacher_id: teacher.id,
    scheduled_at: scheduledAt,
  });
  const upcoming = await call("parent", parent, "/lessons/upcoming");
  assert(upcoming.data.some((x) => x.id === result.makeup_lesson_id));
  assert(!upcoming.data.some((x) => x.id === l.id));
});
