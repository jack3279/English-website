// v2 Stage 6 E2E: 课时包购买 → student_packages + package_payments
const { test, expect, request } = require("@playwright/test");

const ADMIN = { email: "admin@17say.org", password: "Demo1234!" };

async function adminToken(requestCtx) {
  const r = await requestCtx.post("https://api.17say.org/auth/login", {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  const j = await r.json();
  return j.data?.access_token;
}

test("v2 admin 购买课时包: 创 student_package + package_payment", async ({ request: requestCtx }) => {
  const token = await adminToken(requestCtx);
  expect(token).toBeTruthy();

  // 1. 找一个学员
  const stuR = await requestCtx.get("https://api.17say.org/students?pageSize=1", {
    headers: { authorization: `Bearer ${token}` },
  });
  const stuList = (await stuR.json()).data || [];
  expect(stuList.length).toBeGreaterThan(0);
  const studentId = stuList[0].id;
  console.log("  student:", studentId, stuList[0].full_name);

  // 2. 找一个 active package_type
  const ptR = await requestCtx.get("https://api.17say.org/packages/types", {
    headers: { authorization: `Bearer ${token}` },
  });
  const types = (await ptR.json()).data || [];
  const activeType = types.find((t) => t.active) || types[0];
  expect(activeType).toBeTruthy();
  console.log("  package type:", activeType.name, activeType.hours, "h @", activeType.price_cents / 100, "¥");

  // 3. 记录初始 (直接查 packages 数量, 不依赖 student_balance view)
  const beforeR = await requestCtx.get(`https://api.17say.org/students/${studentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const before = (await beforeR.json()).data;
  const beforePkgCount = (before.packages ?? []).length;

  // 4. POST /packages/purchase
  const purchaseR = await requestCtx.post("https://api.17say.org/packages/purchase", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: {
      student_id: studentId,
      package_type_id: activeType.id,
      amount_cents: activeType.price_cents,
      method: "alipay",
      notes: `E2E 自动化测试 ${new Date().toISOString()}`,
    },
  });
  const purchaseJ = await purchaseR.json();
  expect(purchaseR.status()).toBe(200);
  expect(purchaseJ.data.student_package.id).toBeTruthy();
  expect(purchaseJ.data.payment.id).toBeTruthy();
  expect(purchaseJ.data.student_package.total_hours).toBe(activeType.hours);
  expect(purchaseJ.data.student_package.remaining_hours).toBe(activeType.hours);
  console.log("  created student_package:", purchaseJ.data.student_package.id);

  // 5. 验证 packages 数量增加 + 新 package 在 list
  const afterR = await requestCtx.get(`https://api.17say.org/students/${studentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const after = (await afterR.json()).data;
  expect((after.packages ?? []).length).toBe(beforePkgCount + 1);
  const newPkg = (after.packages ?? []).find((p) => p.id === purchaseJ.data.student_package.id);
  expect(newPkg).toBeTruthy();
  expect(newPkg.total_hours).toBe(activeType.hours);
  console.log("  packages increased:", beforePkgCount, "→", (after.packages ?? []).length);

  // 6. 验证 /finance/student/:id 包含新支付
  const finR = await requestCtx.get(`https://api.17say.org/finance/student/${studentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const fin = (await finR.json()).data;
  const newPay = (fin.payments ?? []).find((p) => p.id === purchaseJ.data.payment.id);
  expect(newPay).toBeTruthy();
  expect(newPay.amount_cents).toBe(activeType.price_cents);
  console.log("  finance/student includes new payment, total_paid:", fin.total_paid_cents);

  // 注: 暂不校验 student_balance view (cloud 还没跑 fix-student-balance-view.sql)
  // 等用户在 Supabase SQL Editor 跑完 SQL, view 公式就修正
});

test("v2 admin 调课时 → 写流水 (余额待 SQL fix)", async ({ request: requestCtx }) => {
  const token = await adminToken(requestCtx);
  const stuR = await requestCtx.get("https://api.17say.org/students?pageSize=1", {
    headers: { authorization: `Bearer ${token}` },
  });
  const stuList = (await stuR.json()).data || [];
  const studentId = stuList[0].id;

  // 取初始 tx 数量
  const beforeR = await requestCtx.get(`https://api.17say.org/students/${studentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const before = (await beforeR.json()).data;
  const beforeTxCount = (before.transactions ?? []).length;

  // 调 +5 (delta 写入 lesson_transactions, reason=adjust)
  const adjR = await requestCtx.post(`https://api.17say.org/students/${studentId}/adjust-hours`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: { delta: 5, reason: `E2E 自动化 ${new Date().toISOString()}` },
  });
  const adjJ = await adjR.json();
  expect(adjR.status()).toBe(200);
  expect(adjJ.data.transaction.reason).toBe("adjust");
  expect(adjJ.data.transaction.delta).toBe(5);
  expect(adjJ.data.new_balance).toBe(5 + (before.remaining_hours || 0));

  // 验证流水出现
  const afterR = await requestCtx.get(`https://api.17say.org/students/${studentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const after = (await afterR.json()).data;
  expect((after.transactions ?? []).length).toBe(beforeTxCount + 1);
  const newTx = (after.transactions ?? []).find((t) => t.id === adjJ.data.transaction.id);
  expect(newTx).toBeTruthy();
  expect(newTx.reason).toBe("adjust");
  expect(newTx.note).toMatch(/E2E 自动化/);
  console.log("  adjust verified: tx count", beforeTxCount, "→", (after.transactions ?? []).length, "new balance API reports:", adjJ.data.new_balance);
  // 注: 校验 new_balance = before + 5, 但 student_balance view 公式还是旧的 (只 sum lesson_transactions)
  //     所以 view 显示的还是只含 adjust 增量 (5), 不含 packages.
  //     等用户跑 fix-student-balance-view.sql 后才正确.
});

test("v2 /finance/summary + /finance/exceptions 实时数据", async ({ request: requestCtx }) => {
  const token = await adminToken(requestCtx);

  const sR = await requestCtx.get("https://api.17say.org/finance/summary", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(sR.status()).toBe(200);
  const s = (await sR.json()).data;
  expect(s).toHaveProperty("this_month");
  expect(s).toHaveProperty("total");
  expect(typeof s.this_month.revenue_cents).toBe("number");
  expect(typeof s.total.active_students).toBe("number");
  console.log("  finance summary:", s);

  const eR = await requestCtx.get("https://api.17say.org/finance/exceptions", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(eR.status()).toBe(200);
  const e = (await eR.json()).data;
  expect(e).toHaveProperty("expiring_soon");
  expect(e).toHaveProperty("negative_balance");
  console.log("  finance exceptions: expiring_soon=" + e.expiring_soon.length + " negative=" + e.negative_balance.length);
});