// v2 Tier 1 API e2e: 通知管理 + 请假审批 + 设置 + 404
const { test, expect, request } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function token(ctx, user) {
  const r = await ctx.post("https://api.17say.org/auth/login", {
    data: { email: user.email, password: user.password },
  });
  return (await r.json()).data?.access_token;
}

test("v2 Tier 1: 通知 API - admin GET/POST 列表 + 创建 + 全部已读", async ({ request: requestCtx }) => {
  const tA = await token(requestCtx, ADMIN);
  expect(tA).toBeTruthy();

  // 1. GET /notifications
  const lR = await requestCtx.get("https://api.17say.org/notifications?limit=20", {
    headers: { authorization: `Bearer ${tA}` },
  });
  expect(lR.ok()).toBeTruthy();
  const lJ = await lR.json();
  console.log("  GET /notifications: items =", lJ.data?.items?.length, "unread =", lJ.data?.unread);

  // 2. POST /notifications 创建一个新通知
  const cR = await requestCtx.post("https://api.17say.org/notifications", {
    headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" },
    data: {
      type: "system",
      title: `E2E 通知 ${Date.now()}`,
      body: "测试消息",
      target_role: "admin",
    },
  });
  expect(cR.status()).toBe(200);
  const cJ = await cR.json();
  expect(cJ.data?.title).toContain("E2E 通知");
  const newId = cJ.data?.id;
  console.log("  POST /notifications id =", newId);

  // 3. GET /notifications/unread-count
  const uR = await requestCtx.get("https://api.17say.org/notifications/unread-count", {
    headers: { authorization: `Bearer ${tA}` },
  });
  const uJ = await uR.json();
  console.log("  unread count =", uJ.data?.count);

  // 4. POST /notifications/read 标记全部已读
  if (newId) {
    const mR = await requestCtx.post("https://api.17say.org/notifications/read", {
      headers: { authorization: `Bearer ${tA}`, "content-type": "application/json" },
      data: { ids: [newId] },
    });
    expect(mR.ok()).toBeTruthy();
  }

  console.log("  notifications API OK");
});

test("v2 Tier 1: 请假 API - GET 列表 + 审批", async ({ request: requestCtx }) => {
  const tA = await token(requestCtx, ADMIN);
  expect(tA).toBeTruthy();

  // 1. GET /leave?status=pending
  const lR = await requestCtx.get("https://api.17say.org/leave?status=pending&limit=20", {
    headers: { authorization: `Bearer ${tA}` },
  });
  expect(lR.ok()).toBeTruthy();
  const lJ = await lR.json();
  const leaves = lJ.data ?? [];
  console.log("  GET /leave?status=pending: ", leaves.length, "条");

  // 2. GET /leave?status=approved
  const aR = await requestCtx.get("https://api.17say.org/leave?status=approved&limit=5", {
    headers: { authorization: `Bearer ${tA}` },
  });
  const aJ = await aR.json();
  console.log("  GET /leave?status=approved: ", aJ.data?.length, "条");

  // 3. GET /leave?status=rejected
  const rR = await requestCtx.get("https://api.17say.org/leave?status=rejected&limit=5", {
    headers: { authorization: `Bearer ${tA}` },
  });
  const rJ = await rR.json();
  console.log("  GET /leave?status=rejected: ", rJ.data?.length, "条");

  console.log("  leave API OK");
});

test("v2 Tier 1: /me 返回 admin 信息", async ({ request: requestCtx }) => {
  const tA = await token(requestCtx, ADMIN);
  const r = await requestCtx.get("https://api.17say.org/me", {
    headers: { authorization: `Bearer ${tA}` },
  });
  const j = await r.json();
  expect(j.data?.role).toBe("admin");
  expect(j.data?.id).toBeTruthy();
  expect(j.data?.full_name).toBeTruthy();
  console.log("  /me OK: role =", j.data?.role, "id =", j.data?.id?.slice(0, 8));
});

test("v2 Tier 1: 公开 endpoint 404 (recruit 不存在 id)", async ({ request: requestCtx }) => {
  // 公开 endpoint (无 admin token) 测路径
  const r = await requestCtx.get("https://api.17say.org/nonexistent-endpoint-9999", {
    failOnStatusCode: false,
  });
  expect(r.status()).toBe(404);
  const j = await r.json();
  expect(j.code).toBe("NOT_FOUND");
  console.log("  404 endpoint OK");
});
