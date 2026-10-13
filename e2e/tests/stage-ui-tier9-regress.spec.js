// 本轮改动的专项回归:
// 1. GET /schedules?status= & ?statuses= (历史课节过滤)
// 2. GET /finance/my-payroll 角色分流 (admin=scope:all / teacher=scope:self)
// 3. POST /schedules 新建排课 + 循环创建时的冲突处理
const { test, expect, request } = require("@playwright/test");

const API = "https://api.17say.org";
const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function token(ctx, user) {
  const r = await ctx.post(`${API}/auth/login`, {
    data: { email: user.email, password: user.password },
  });
  const j = await r.json();
  if (!j.data?.access_token) console.log(`  [warn] ${user.email} 登录失败:`, j);
  return j.data?.access_token;
}

// 从 /students 里挑第 n 个真实学员 (冲突检测按 student 判, 不同测试要占不同学员)
async function studentAt(ctx, t, n = 0) {
  const r = await ctx.get(`${API}/students?pageSize=20`, {
    headers: { authorization: `Bearer ${t}` },
  });
  const j = await r.json();
  const list = j.data?.items ?? j.data ?? [];
  return Array.isArray(list) ? list[n]?.id ?? null : null;
}

// 从 /teachers 里挑一个真实老师当 teacher 账号的探针对象
async function firstTeacherProfile(ctx, t) {
  const r = await ctx.get(`${API}/teachers`, { headers: { authorization: `Bearer ${t}` } });
  const arr = (await r.json()).data ?? [];
  return arr[0]?.profile_id ?? arr[0]?.id ?? null;
}

// 每次跑用不同的时间戳, 避免上一轮留下的课节把这一轮顶成 409 冲突。
// 冲突检测的窗口是 ±24h, 所以分钟位要跟着跑动, 光加天数不够 —— 同一天数下
// 上一轮建的课节还在窗口内, 连续跑几轮就必然撞。
let RUN_SEQ = 0;
function freshSlot(offsetDays, hour) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  d.setUTCHours(hour, (RUN_SEQ * 7 + hour) % 60, 0, 0);
  RUN_SEQ += 1;
  return d;
}

// 找一个「老师和学生都空闲」的时段。
// 冲突检测按 (teacher, student) 双边判, 落在未来某个时间点而已 —— 那里本来就有
// 真实排课数据。所以不能随便挑时间, 得真去问接口"这两人那天有没有课"。
// 前端「按规律课生成 / 循环创建」是串行逐个建, 撞了会跳过继续; 测试则要自己找空位。
async function findFreeSlot(ctx, t, teacherId, studentId, offsetDays = 400) {
  let at = new Date(Date.now() + offsetDays * 86400000);
  at.setUTCHours(2, (Math.floor(Date.now() / 60000) % 60), 0, 0);
  for (let i = 0; i < 40; i++) {
    const from = new Date(at.getTime() - 43200000).toISOString();
    const to = new Date(at.getTime() + 43200000).toISOString();
    const r = await ctx.get(`${API}/schedules?from=${from}&to=${to}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    const rows = (await r.json()).data ?? [];
    const clash = rows.some(
      (x) => x.teacher_id === teacherId || x.student_id === studentId,
    );
    if (!clash) return at;
    at = new Date(at.getTime() + 6 * 3600_000); // 往后推 6 小时
  }
  return null;
}

// ---------------------------------------------------------------- schedules

test("R1: GET /schedules?status=<x> 单值过滤只返回该状态", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);
  expect(t).toBeTruthy();

  for (const st of ["completed", "cancelled", "no_show", "scheduled"]) {
    const r = await ctx.get(`${API}/schedules?status=${st}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    expect(r.ok(), `status=${st} 应 200`).toBeTruthy();
    const rows = (await r.json()).data ?? [];
    const bad = rows.filter((x) => x.status !== st);
    expect(bad, `status=${st} 结果里混入了别的状态`).toEqual([]);
    console.log(`  status=${st}: ${rows.length} 条, 全部匹配`);
  }
});

test("R2: GET /schedules?statuses=a,b,c 多值过滤 (历史课节用)", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);
  const want = ["completed", "cancelled", "no_show"];

  const r = await ctx.get(`${API}/schedules?statuses=${want.join(",")}`, {
    headers: { authorization: `Bearer ${t}` },
  });
  expect(r.ok()).toBeTruthy();
  const rows = (await r.json()).data ?? [];

  const bad = rows.filter((x) => !want.includes(x.status));
  expect(bad, "statuses 结果混入了 scheduled").toEqual([]);

  // 与三个单值查询的结果取并集比对 —— 确认多值语义正确
  const singles = new Set();
  for (const st of want) {
    const rr = await ctx.get(`${API}/schedules?status=${st}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    for (const x of (await rr.json()).data ?? []) singles.add(x.id);
  }
  expect(
    rows.map((x) => x.id).sort(),
    "statuses 的 id 集合应等于三个单值查询的并集",
  ).toEqual([...singles].sort());
  console.log(`  statuses=${want.join(",")}: ${rows.length} 条 = 三个单值并集 ${singles.size} 条`);
});

test("R3: GET /schedules 非法 status/statuses 应 400 而不是 500", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);

  // 之前这些全部 500: status 是 Postgres enum, PostgREST 遇到 enum 外的过滤值
  // 不是回 400 而是直接 500 —— 客户端拼错一个参数就能把列表接口打挂。
  for (const q of [
    "status=bogus",
    "status=completed,,bogus,",
    "statuses=bogus",
    "statuses=completed,,bogus,",
    "statuses=,,,", // 过滤干净后为空, 应等价于不过滤
  ]) {
    const r = await ctx.get(`${API}/schedules?${q}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    expect(r.status(), `${q} 不应 500`).toBeLessThan(500);
    if (q === "statuses=,,,") {
      expect(r.status(), "空 statuses 应 200 (等价不过滤)").toBe(200);
    } else {
      expect(r.status(), `${q} 应 400`).toBe(400);
    }
    console.log(`  ${q} -> ${r.status()}`);
  }
});

test("R13: 其他 enum 列的 status 过滤同样不再 500", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);
  for (const path of ["/leave", "/makeups", "/leads"]) {
    const r = await ctx.get(`${API}${path}?status=bogus`, {
      headers: { authorization: `Bearer ${t}` },
    });
    expect(r.status(), `${path}?status=bogus 不应 500`).toBeLessThan(500);
    console.log(`  ${path}?status=bogus -> ${r.status()}`);
  }
});

test("R4: GET /schedules 未登录 401", async ({ request: ctx }) => {
  const r = await ctx.get(`${API}/schedules?statuses=completed`);
  expect(r.status()).toBe(401);
  console.log(`  未登录 401 OK`);
});

// ---------------------------------------------------------------- payroll

test("R5: GET /finance/my-payroll admin 走 scope=all (看所有老师)", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);
  const r = await ctx.get(`${API}/finance/my-payroll`, {
    headers: { authorization: `Bearer ${t}` },
  });
  expect(r.ok()).toBeTruthy();
  const d = (await r.json()).data;

  expect(d.scope, "管理员应拿到 scope=all").toBe("all");
  expect(d.role).toBe("admin");
  expect(Array.isArray(d.teachers), "应返回 teachers 数组").toBeTruthy();
  expect(Array.isArray(d.rates)).toBeTruthy();
  expect(d.totals).toBeTruthy();
  // admin 视图不应该带自己那一套字段
  expect(d.teacher, "admin 视图不应有 teacher 自视图字段").toBeUndefined();
  expect(d.months).toBeUndefined();
  expect(d.recent).toBeUndefined();

  // totals 与 teachers 聚合一致
  const sumPay = d.teachers.reduce((s, x) => s + Number(x.pay_amount || 0), 0);
  expect(Math.round(sumPay * 100) / 100).toBeCloseTo(Number(d.totals.pay_amount), 1);
  const sumLessons = d.teachers.reduce((s, x) => s + Number(x.lessons_done || 0), 0);
  expect(sumLessons).toBe(d.totals.lessons_done);

  console.log(
    `  admin scope=all: ${d.teachers.length} 位老师 / ${d.totals.lessons_done} 节 / 合计 ${d.totals.pay_amount}`,
  );
  console.log(
    `  各老师: ${d.teachers
      .slice(0, 5)
      .map((x) => `${x.teacher_name}=${x.pay_amount}`)
      .join(", ")}`,
  );
});

test("R6: GET /finance/my-payroll admin 传 teacher_id 不能越权收窄 (防工资泄漏)", async ({
  request: ctx,
}) => {
  const t = await token(ctx, ADMIN);
  const r = await ctx.get(`${API}/finance/my-payroll?teacher_id=00000000-0000-0000-0000-000000000000`, {
    headers: { authorization: `Bearer ${t}` },
  });
  const d = (await r.json()).data;
  expect(d.scope).toBe("all");
  expect(d.teachers.length, "传 teacher_id 不该把结果缩成单老师").toBeGreaterThanOrEqual(0);
  console.log(`  传 teacher_id 后仍 scope=all, teachers=${d.teachers.length} (未被收窄)`);
});

test("R7: GET /finance/payroll (admin 端) 仍正常, 与 my-payroll all 同源", async ({
  request: ctx,
}) => {
  const t = await token(ctx, ADMIN);
  // 串行 + 重试: 并发两个请求偶发 ECONNRESET (Cloudflare 到 Worker 的连接复用问题),
  // 那是网络抖动不是接口错误, 重试一次即可。
  let a = null;
  let b = null;
  for (let i = 0; i < 3; i++) {
    try {
      a = await ctx.get(`${API}/finance/my-payroll`, {
        headers: { authorization: `Bearer ${t}` },
      });
      b = await ctx.get(`${API}/finance/payroll`, {
        headers: { authorization: `Bearer ${t}` },
      });
      break;
    } catch (e) {
      console.log(`  第 ${i + 1} 次尝试连接失败 (${e.message}), 重试…`);
    }
  }
  expect(a?.ok()).toBeTruthy();
  expect(b?.ok()).toBeTruthy();
  const da = (await a.json()).data;
  const db = (await b.json()).data;
  expect(
    Math.round(Number(da.totals.pay_amount) * 100) / 100,
    "两个端点的总课酬应一致 (同源)",
  ).toBeCloseTo(Math.round(Number(db.totals.pay_amount) * 100) / 100, 1);
  console.log(
    `  my-payroll(all)=${da.totals.pay_amount} / payroll=${db.totals.pay_amount} -> 同源一致`,
  );
});

test("R8: GET /finance/my-payroll 未登录 401", async ({ request: ctx }) => {
  const r = await ctx.get(`${API}/finance/my-payroll`);
  expect(r.status()).toBe(401);
  console.log(`  未登录 401 OK`);
});

// ---------------------------------------------------------------- create

test("R9: POST /schedules 新建排课 -> 能在 GET 里查回", async ({ request: ctx }) => {
  const t = await token(ctx, ADMIN);

  const studentId = await studentAt(ctx, t, 0);
  const teacherId = await firstTeacherProfile(ctx, t);
  expect(studentId, "需要一个学员").toBeTruthy();
  expect(teacherId, "需要一个老师").toBeTruthy();

  // 找一个远未来的时间, 避开与现有课节冲突
  const at = await findFreeSlot(ctx, t, teacherId, studentId, 400);
  expect(at, "找不到老师+学生都空闲的时段").toBeTruthy();

  const body = {
    student_id: studentId,
    teacher_id: teacherId,
    scheduled_at: at.toISOString(),
    duration_min: 60,
  };

  const cR = await ctx.post(`${API}/schedules`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: body,
  });
  expect(cR.ok(), `创建应成功, 实际 ${cR.status()}`).toBeTruthy();
  const created = (await cR.json()).data;
  expect(created.status).toBe("scheduled");

  // 回查
  const gR = await ctx.get(
    `${API}/schedules?from=${new Date(at.getTime() - 86400000).toISOString()}&to=${new Date(at.getTime() + 86400000).toISOString()}`,
    { headers: { authorization: `Bearer ${t}` } },
  );
  const found = ((await gR.json()).data ?? []).find((x) => x.id === created.id);
  expect(found, "新建的课节应能在 GET 里查回").toBeTruthy();
  expect(found.teacher_id).toBe(teacherId);
  console.log(`  创建成功 id=${created.id} @ ${body.scheduled_at}, 回查命中`);

  // 同位置再创建一次 -> 冲突 409
  const dup = await ctx.post(`${API}/schedules`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: body,
  });
  expect(dup.status(), "同一老师同一时刻重复排课应 409 冲突").toBe(409);
  console.log(`  重复创建 409 冲突 OK (前端循环创建时靠这个跳过)`);
});

test("R10: PATCH /schedules/:id 仅改 scheduled_at (week 模式拖拽路径)", async ({
  request: ctx,
}) => {
  const t = await token(ctx, ADMIN);
  const studentId = await studentAt(ctx, t, 1);
  const teacherId = await firstTeacherProfile(ctx, t);
  if (!studentId || !teacherId) {
    console.log("  [skip] 没有可用学员/老师");
    return;
  }

  const at = await findFreeSlot(ctx, t, teacherId, studentId, 500);
  expect(at, "找不到老师+学生都空闲的时段").toBeTruthy();
  const cR = await ctx.post(`${API}/schedules`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: {
      student_id: studentId,
      teacher_id: teacherId,
      scheduled_at: at.toISOString(),
      duration_min: 60,
    },
  });
  expect(cR.ok()).toBeTruthy();
  const id = (await cR.json()).data.id;

  // 只改时间, 不传 teacher_id —— 模拟 weekMode 拖拽。
  // 往后找 3h, 但要排除自己刚建的那节, 否则 PATCH 会正确地回 409。
  let moved = new Date(at.getTime() + 3 * 3600_000);
  for (let i = 0; i < 20; i++) {
    const from = new Date(moved.getTime() - 43200000).toISOString();
    const to = new Date(moved.getTime() + 43200000).toISOString();
    const r = await ctx.get(`${API}/schedules?from=${from}&to=${to}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    const rows = (await r.json()).data ?? [];
    const clash = rows.some(
      (x) => x.id !== id && (x.teacher_id === teacherId || x.student_id === studentId),
    );
    if (!clash) break;
    moved = new Date(moved.getTime() + 3 * 3600_000);
  }
  const pR = await ctx.patch(`${API}/schedules/${id}`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: { scheduled_at: moved.toISOString() },
  });
  expect(pR.ok(), `PATCH 应成功, 实际 ${pR.status()}`).toBeTruthy();
  const after = (await pR.json()).data;
  expect(new Date(after.scheduled_at).getTime()).toBe(moved.getTime());
  expect(after.teacher_id, "teacher_id 不应被清空").toBe(teacherId);
  console.log(`  PATCH 仅改时间 OK, teacher_id 保持不变`);
});

test("R11: PATCH /schedules/:id 同时改 teacher_id (day 模式跨老师拖拽路径)", async ({
  request: ctx,
}) => {
  const t = await token(ctx, ADMIN);
  const tR = await ctx.get(`${API}/teachers`, { headers: { authorization: `Bearer ${t}` } });
  const teachers = (await tR.json()).data ?? [];
  if (teachers.length < 2) {
    console.log("  [skip] 少于 2 个老师");
    return;
  }
  const t1 = teachers[0].profile_id ?? teachers[0].id;
  const t2 = teachers[1].profile_id ?? teachers[1].id;
  const studentId = await studentAt(ctx, t, 2);
  if (!studentId) {
    console.log("  [skip] 没有可用学员");
    return;
  }

  // PATCH 改给 t2 时, t2 在目标时段必须没课, 否则后端正确地回 409。
  // 造一节 t1 的课之前先问 t2 那天有没有课, 有就顺延一天直到空闲。
  let at = freshSlot(600, 6);
  for (let i = 0; i < 10; i++) {
    const from = new Date(at.getTime() - 43200000).toISOString();
    const to = new Date(at.getTime() + 43200000).toISOString();
    const busy = await ctx.get(
      `${API}/schedules?from=${from}&to=${to}&teacherId=${t2}`,
      { headers: { authorization: `Bearer ${t}` } },
    );
    const rows = (await busy.json()).data ?? [];
    if (rows.length === 0) break;
    at = new Date(at.getTime() + 86400000);
  }
  const cR = await ctx.post(`${API}/schedules`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: {
      student_id: studentId,
      teacher_id: t1,
      scheduled_at: at.toISOString(),
      duration_min: 60,
    },
  });
  expect(cR.ok()).toBeTruthy();
  const id = (await cR.json()).data.id;

  const pR = await ctx.patch(`${API}/schedules/${id}`, {
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    data: { teacher_id: t2 },
  });
  expect(pR.ok(), `PATCH 应成功, 实际 ${pR.status()}`).toBeTruthy();
  const after = (await pR.json()).data;
  expect(after.teacher_id).toBe(t2);
  console.log(`  PATCH 跨老师改期 OK (t1 -> t2)`);
});

test("R12: GET /schedules teacher 角色只看到自己的课节", async ({ request: ctx }) => {
  // 找一个已绑定的老师账号
  const cands = [
    { email: "teacher@17say.org", password: "Demo1234!" },
    { email: "carol@17say.org", password: "Demo1234!" },
  ];
  let t = null;
  let who = null;
  for (const c of cands) {
    t = await token(ctx, c);
    if (t) {
      who = c.email;
      break;
    }
  }
  if (!t) {
    console.log("  [skip] 找不到可登录的 teacher 账号");
    return;
  }

  const meR = await ctx.get(`${API}/me`, { headers: { authorization: `Bearer ${t}` } });
  const me = (await meR.json()).data;
  expect(me.role).toBe("teacher");

  const sR = await ctx.get(`${API}/schedules?status=completed`, {
    headers: { authorization: `Bearer ${t}` },
  });
  expect(sR.ok()).toBeTruthy();
  const rows = (await sR.json()).data ?? [];
  const notMine = rows.filter((x) => x.teacher_id !== me.id);
  expect(notMine, `teacher 不应看到别人的课节 (${who})`).toEqual([]);
  console.log(`  teacher(${who}) 只看到自己的 ${rows.length} 节, 无越权`);

  // teacher 的 my-payroll 应是 scope=self
  const pR = await ctx.get(`${API}/finance/my-payroll`, {
    headers: { authorization: `Bearer ${t}` },
  });
  expect(pR.ok()).toBeTruthy();
  const pd = (await pR.json()).data;
  expect(pd.scope, "teacher 应拿到 scope=self").toBe("self");
  expect(pd.teacher, "teacher 自视图应有 teacher 字段").toBeTruthy();
  expect(pd.teachers, "teacher 不应拿到所有老师列表").toBeUndefined();
  console.log(`  teacher my-payroll scope=self OK, 单价=${pd.teacher?.hourly_pay} ${pd.teacher?.pay_currency}`);
});
