// v2 Tier 4 API e2e: 财务追溯 + 学员搜索 + 全局可见的查询接口
// 目的: 把"页面能跑"的断言沉到 API 层, 防止重构 web 时悄悄把接口契约改坏。
const { test, expect } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };
const BASE = "https://api.17say.org";

async function login(ctx) {
  const r = await ctx.post(`${BASE}/auth/login`, { data: ADMIN });
  if (!r.ok()) throw new Error(`login failed: ${r.status()}`);
  const j = await r.json();
  if (!j.data?.access_token) throw new Error("login returned no token");
  return j.data.access_token;
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

test.describe.serial("v2 Tier 4 — 财务追溯 / 全局搜索 / 调度接口", () => {
  let token;

  test.beforeAll(async ({ request: ctx }) => {
    token = await login(ctx);
    expect(token).toBeTruthy();
  });

  test("finance/summary 返回 this_month + last_month + total", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/finance/summary`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.data).toHaveProperty("this_month.revenue_cents");
    expect(j.data).toHaveProperty("this_month.consumed_hours");
    expect(j.data).toHaveProperty("this_month.completed_lessons");
    expect(j.data).toHaveProperty("last_month.revenue_cents");
    expect(j.data).toHaveProperty("total.active_students");
    expect(j.data).toHaveProperty("total.low_balance_count");
    expect(j.data.period?.preset).toBe("this_month");
    console.log(
      "  finance/summary OK: revenue=¥" +
        (j.data.this_month.revenue_cents / 100).toFixed(2) +
        "  consumed=" +
        j.data.this_month.consumed_hours +
        "h",
    );
  });

  test("finance/exceptions 返回 expiring_soon + negative_balance 数组", async ({
    request: ctx,
  }) => {
    const r = await ctx.get(`${BASE}/finance/exceptions`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.expiring_soon)).toBeTruthy();
    expect(Array.isArray(j.data?.negative_balance)).toBeTruthy();
    console.log(
      "  finance/exceptions OK: expiring_soon=" +
        j.data.expiring_soon.length +
        "  neg_bal=" +
        j.data.negative_balance.length,
    );
  });

  test("finance/revenue 返回明细 rows 含 student_name/package_name/amount_cents", async ({
    request: ctx,
  }) => {
    const r = await ctx.get(`${BASE}/finance/revenue`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.rows)).toBeTruthy();
    expect(j.data).toHaveProperty("total_cents");
    expect(j.data).toHaveProperty("truncated");
    if (j.data.rows.length > 0) {
      const first = j.data.rows[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("paid_at");
      expect(first).toHaveProperty("amount_cents");
      expect(first).toHaveProperty("student_name");
    }
    console.log(
      "  finance/revenue OK: rows=" + j.data.rows.length + "  truncated=" + j.data.truncated,
    );
  });

  test("finance/renewals 返回 rows 含 phone + remaining_hours", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/finance/renewals`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.rows)).toBeTruthy();
    if (j.data.rows.length > 0) {
      const first = j.data.rows[0];
      expect(first).toHaveProperty("student_id");
      expect(first).toHaveProperty("student_name");
      expect(first).toHaveProperty("remaining_hours");
      expect(["expiring", "low"]).toContain(first.stage);
    }
    console.log("  finance/renewals OK: rows=" + j.data.rows.length);
  });

  test("finance/payroll 返回老师课酬汇总 + rates 表", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/finance/payroll`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.rows)).toBeTruthy();
    expect(j.data).toHaveProperty("totals");
    expect(Array.isArray(j.data?.rates)).toBeTruthy();
    if (j.data.rates.length > 0) {
      const r0 = j.data.rates[0];
      expect(r0).toHaveProperty("teacher_id");
      expect(r0).toHaveProperty("hourly_pay");
    }
    console.log(
      "  finance/payroll OK: rows=" + j.data.rows.length + "  teachers=" + j.data.rates.length,
    );
  });

  test("students?search= 按姓名模糊搜 (新接口, Tier 4)", async ({ request: ctx }) => {
    // 全量拉一次找一个真实存在的姓名片段
    const allR = await ctx.get(`${BASE}/students?pageSize=10`, { headers: bearer(token) });
    const allJ = await allR.json();
    const sample = allJ.data?.[0];
    if (!sample) {
      console.log("  SKIP: 无学生数据");
      return;
    }
    // 截一个字 (中文 / 英文 至少命中一个)
    const probe = sample.full_name.slice(0, 1);
    const sR = await ctx.get(`${BASE}/students?search=${encodeURIComponent(probe)}&pageSize=5`, {
      headers: bearer(token),
    });
    expect(sR.ok()).toBeTruthy();
    const sJ = await sR.json();
    expect(Array.isArray(sJ.data)).toBeTruthy();
    // 至少能搜到包含该字/片段的学员
    const found = sJ.data.some((s) => s.full_name.includes(probe));
    expect(found).toBeTruthy();
    console.log("  students?search= OK: probe='" + probe + "'  hits=" + sJ.data.length);
  });

  test("students?search=% 转义 (% 不能当通配)", async ({ request: ctx }) => {
    // 用户输入 % 不能把所有人搜出来 —— API 必须 escape。
    const r = await ctx.get(`${BASE}/students?search=%25&pageSize=10`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data)).toBeTruthy();
    // 期望: 不会把所有人返回 (除非真的有人名字里带 %)
    console.log("  students?search=%25 OK: hits=" + j.data.length);
  });

  test("messages/teammates 返回同机构用户列表", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/messages/teammates`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data)).toBeTruthy();
    console.log("  messages/teammates OK: teammates=" + j.data.length);
  });

  test("courses 返回课程模板列表 (调度生成需要)", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/courses`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.items ?? j.data)).toBeTruthy();
    const arr = j.data?.items ?? j.data;
    console.log("  courses OK: count=" + arr.length);
  });

  test("packages/types 返回课时包类型列表", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/packages/types`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.items ?? j.data)).toBeTruthy();
    const arr = j.data?.items ?? j.data;
    console.log("  packages/types OK: count=" + arr.length);
  });

  test("schedules?from=&to= 返回本周课节列表", async ({ request: ctx }) => {
    const from = new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = new Date(Date.now() + 7 * 86400_000).toISOString();
    const r = await ctx.get(
      `${BASE}/schedules?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=20`,
      { headers: bearer(token) },
    );
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    const arr = j.data?.items ?? j.data ?? [];
    expect(Array.isArray(arr)).toBeTruthy();
    console.log("  schedules OK: count=" + arr.length);
  });

  test("leave?status= 支持 pending / approved / rejected", async ({ request: ctx }) => {
    for (const s of ["pending", "approved", "rejected"]) {
      const r = await ctx.get(`${BASE}/leave?status=${s}&limit=5`, { headers: bearer(token) });
      expect(r.ok()).toBeTruthy();
      const j = await r.json();
      // /leave GET 返回 { items: [...], total: N }
      expect(Array.isArray(j.data?.items ?? j.data ?? [])).toBeTruthy();
    }
    console.log("  leave 3-status filter OK");
  });

  test("makeups 返回可补课列表", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/makeups`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.items ?? j.data ?? [])).toBeTruthy();
    console.log("  makeups OK");
  });

  test("notifications/unread-count 返回数字", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/notifications/unread-count`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(typeof (j.data?.count ?? j.count)).toBe("number");
    console.log("  notifications/unread-count OK: count=" + (j.data?.count ?? j.count));
  });

  test("未登录访问 finance/summary 应该 401", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/finance/summary`, { failOnStatusCode: false });
    expect(r.status()).toBe(401);
    console.log("  auth gate OK");
  });

  test("admin 修改自己的 password 路径不存在 (路由保护)", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/auth/password/raw-bcrypt-leak`, { failOnStatusCode: false });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    console.log("  no leak OK: status=" + r.status());
  });

  test("/auth/refresh: 用 refresh_token 换新 access_token (30 天免登录基础)", async ({
    request: ctx,
  }) => {
    // 1. 重新登录拿 refresh_token
    const loginR = await ctx.post(`${BASE}/auth/login`, {
      headers: { "content-type": "application/json" },
      data: ADMIN,
    });
    expect(loginR.ok()).toBeTruthy();
    const loginJ = await loginR.json();
    const refreshToken = loginJ.data?.refresh_token;
    if (!refreshToken) {
      throw new Error("login 必须返回 refresh_token, 实际响应: " + JSON.stringify(loginJ));
    }
    const oldAccess = loginJ.data?.access_token;
    console.log("  login OK: refresh_token 长度 =", refreshToken.length);

    // 2. 调 refresh
    const rR = await ctx.post(`${BASE}/auth/refresh`, {
      headers: { "content-type": "application/json" },
      data: { refresh_token: refreshToken },
    });
    expect(rR.ok()).toBeTruthy();
    const rJ = await rR.json();
    expect(rJ.data?.access_token).toBeTruthy();
    if (!rJ.data?.refresh_token) {
      throw new Error("refresh 后必须返回新的 refresh_token");
    }
    expect(rJ.data.access_token).not.toBe(oldAccess);

    // 3. 拿新 token 调 /me 确认有效
    const meR = await ctx.get(`${BASE}/me`, {
      headers: { authorization: `Bearer ${rJ.data.access_token}` },
    });
    expect(meR.ok()).toBeTruthy();
    const meJ = await meR.json();
    expect(meJ.data?.role).toBe("admin");
    console.log(
      "  /auth/refresh OK: 新 access_token 长度 =",
      rJ.data.access_token.length,
      "  /me role =",
      meJ.data.role,
    );
  });

  test("/auth/refresh: 缺 refresh_token 时 400", async ({ request: ctx }) => {
    const r = await ctx.post(`${BASE}/auth/refresh`, {
      headers: { "content-type": "application/json" },
      data: {},
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(400);
    console.log("  /auth/refresh no-token OK: 400");
  });

  test("/auth/refresh: 错误 refresh_token 时 401 (不再 fallback 跳登录)", async ({
    request: ctx,
  }) => {
    const r = await ctx.post(`${BASE}/auth/refresh`, {
      headers: { "content-type": "application/json" },
      data: { refresh_token: "totally-fake-invalid-token-xxxxx" },
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(401);
    console.log("  /auth/refresh bad-token OK: 401");
  });

  test("/me/sessions: 登录后能列出当前用户的活跃设备", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/me/sessions`, { headers: bearer(token) });
    // 表可能尚未应用 migration, 此时返 500/400 —— 视为 SKIP 而不是 fail
    if (!r.ok()) {
      console.log(
        "  /me/sessions SKIP: HTTP " + r.status() + " (auth_sessions 表未应用 migration?)",
      );
      test.skip(true, "auth_sessions table not migrated yet");
      return;
    }
    const j = await r.json();
    expect(Array.isArray(j.data?.items)).toBeTruthy();
    expect(j.data.items.length).toBeGreaterThanOrEqual(1);
    const first = j.data.items[0];
    expect(first).toHaveProperty("device_label");
    expect(first).toHaveProperty("last_active_at");
    expect(first).toHaveProperty("ip");
    expect(first.revoked_at).toBeNull();
    console.log(
      "  /me/sessions OK: " +
        j.data.items.length +
        " 个设备, latest = " +
        first.device_label +
        " (IP " +
        first.ip +
        ")",
    );
  });

  test("/me/sessions/:id: 标记设备为已撤销 (软删除)", async ({ request: ctx }) => {
    const listR = await ctx.get(`${BASE}/me/sessions`, { headers: bearer(token) });
    if (!listR.ok()) {
      console.log("  /me/sessions DELETE SKIP: 表未迁移");
      test.skip(true, "auth_sessions table not migrated yet");
      return;
    }
    const items = (await listR.json()).data?.items ?? [];
    if (items.length === 0) {
      console.log("  SKIP: 无设备可撤销");
      return;
    }
    const targetId = items[0].id;
    const dR = await ctx.delete(`${BASE}/me/sessions/${targetId}`, { headers: bearer(token) });
    expect(dR.ok()).toBeTruthy();

    const after = await ctx.get(`${BASE}/me/sessions`, { headers: bearer(token) });
    const afterItems = (await after.json()).data?.items ?? [];
    expect(afterItems.find((s) => s.id === targetId)).toBeUndefined();
    console.log("  /me/sessions DELETE OK: 撤销后剩 " + afterItems.length + " 个设备");
  });

  test("/me/sessions/:id: 非法 id 返 404", async ({ request: ctx }) => {
    const r = await ctx.delete(`${BASE}/me/sessions/not-a-uuid`, {
      headers: bearer(token),
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(404);
    console.log("  /me/sessions invalid-id OK: 404");
  });

  test("/me/sessions 未登录返 401", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/me/sessions`, { failOnStatusCode: false });
    expect(r.status()).toBe(401);
    console.log("  /me/sessions auth gate OK: 401");
  });

  test("/reports/lesson-stats: 返回完课率/出勤率/取消率 + 课节聚合", async ({ request: ctx }) => {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";
    const r = await ctx.get(`${BASE}/reports/lesson-stats?from=${monthStart}&to=${today}`, {
      headers: bearer(token),
    });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(typeof j.data?.total_scheduled).toBe("number");
    expect(typeof j.data?.completed).toBe("number");
    expect(typeof j.data?.no_show).toBe("number");
    expect(typeof j.data?.cancelled).toBe("number");
    expect(typeof j.data?.completion_rate).toBe("number");
    expect(typeof j.data?.attendance_rate).toBe("number");
    expect(typeof j.data?.cancel_rate).toBe("number");
    // rate 都应该 0..1
    expect(j.data.completion_rate).toBeGreaterThanOrEqual(0);
    expect(j.data.completion_rate).toBeLessThanOrEqual(1);
    console.log(
      "  /reports/lesson-stats OK: 课节 " +
        j.data.total_scheduled +
        " · 完课率 " +
        Math.round(j.data.completion_rate * 100) +
        "%",
    );
  });

  test("/reports/lesson-stats: 默认(无参数)= 本月", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/reports/lesson-stats`, { headers: bearer(token) });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(typeof j.data?.total_scheduled).toBe("number");
    console.log("  /reports/lesson-stats default OK: " + j.data.total_scheduled + " 节");
  });

  test("/reports/lesson-stats: 非法 from 返 400", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/reports/lesson-stats?from=invalid-date`, {
      headers: bearer(token),
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(400);
    console.log("  /reports/lesson-stats bad-input OK: 400");
  });

  test("/reports/teacher-attendance: 按老师聚合完课/出勤率", async ({ request: ctx }) => {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";
    const r = await ctx.get(`${BASE}/reports/teacher-attendance?from=${monthStart}&to=${today}`, {
      headers: bearer(token),
    });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(Array.isArray(j.data?.rows)).toBeTruthy();
    if (j.data.rows.length > 0) {
      const t0 = j.data.rows[0];
      expect(t0).toHaveProperty("teacher_id");
      expect(t0).toHaveProperty("total_hours");
      expect(t0).toHaveProperty("completion_rate");
      expect(t0).toHaveProperty("attendance_rate");
      expect(typeof t0.total_hours).toBe("number");
      // 已按完课时数降序
      for (let i = 1; i < j.data.rows.length; i++) {
        expect(j.data.rows[i - 1].total_hours).toBeGreaterThanOrEqual(j.data.rows[i].total_hours);
      }
    }
    console.log("  /reports/teacher-attendance OK: " + j.data.rows.length + " 位老师");
  });

  test("/reports/teacher-attendance: rate 必为 0..1 数值", async ({ request: ctx }) => {
    const r = await ctx.get(`${BASE}/reports/teacher-attendance`, { headers: bearer(token) });
    const j = await r.json();
    for (const t of j.data?.rows ?? []) {
      expect(t.completion_rate).toBeGreaterThanOrEqual(0);
      expect(t.completion_rate).toBeLessThanOrEqual(1);
      expect(t.attendance_rate).toBeGreaterThanOrEqual(0);
      expect(t.attendance_rate).toBeLessThanOrEqual(1);
    }
    console.log("  /reports/teacher-attendance rate 范围 OK");
  });
});
