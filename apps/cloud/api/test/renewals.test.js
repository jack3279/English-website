const test = require("node:test"),
  assert = require("node:assert/strict");
require("./setup.js");
let memory, db, writes, failPayment;
const sid = "11111111-1111-4111-8111-111111111111",
  pid = "22222222-2222-4222-8222-222222222222",
  oid = "33333333-3333-4333-8333-333333333333";
const qr = "data:image/png;base64,aGVsbG8=";
const store = {
  ready: () => true,
  randomId: () => Math.random().toString(),
  read: async (k, f) => ({ value: structuredClone(memory.get(k) ?? f) }),
  change: async (k, f, fn) => {
    const next = await fn(structuredClone(memory.get(k) ?? f));
    if (next !== null) memory.set(k, structuredClone(next));
    return next;
  },
};
require.cache[require.resolve("../lib/secureStore.js")] = { exports: store };
require.cache[require.resolve("../lib/supabase.js")] = {
  exports: {
    getAdmin: () => ({
      from: (table) => {
        let id;
        const q = {
          select: () => q,
          eq: (key, val) => {
            if (key === "id") id = val;
            return q;
          },
          maybeSingle: async () => ({ data: db.get(`${table}/${id}`) || null }),
        };
        return q;
      },
    }),
  },
};
require.cache[require.resolve("../lib/scoping.js")] = {
  exports: { canSeeStudent: async (req, id) => id === sid },
};
require.cache[require.resolve("../lib/adminConfirmation.js")] = {
  exports: {
    verify: async (req, pw) => {
      if (pw !== "qa-password") throw new Error("wrong password");
    },
  },
};
require.cache[require.resolve("../lib/rest.js")] = {
  exports: {
    restInsert: async (table, value) => {
      if (table === "package_payments" && failPayment) {
        failPayment = false;
        throw new Error("timeout");
      }
      writes.push(table);
      db.set(`${table}/${value.id}`, value);
      return [value];
    },
  },
};
const handler = require("../routes/renewals.js");
async function call(role, path, method = "GET", body = {}, user = "parent") {
  let result;
  const res = {
    status() {
      return this;
    },
    json(v) {
      result = v.data;
      return this;
    },
  };
  await handler(
    {
      url: `http://x${path}`,
      method,
      body,
      headers: {},
      __testUser: { id: role === "admin" ? "admin" : user, role },
    },
    res,
  );
  return result;
}
test.beforeEach(() => {
  memory = new Map([
    ["private/renewals/config", { enabled: true, recipient: "QA", qr, instructions: "QA" }],
  ]);
  db = new Map([
    [
      `package_types/${pid}`,
      { id: pid, name: "QA十课时", hours: 10, price_cents: 80000, active: true },
    ],
    [`students/${sid}`, { id: sid, full_name: "QA学生" }],
  ]);
  writes = [];
  failPayment = false;
});
// Historical orders remain reconcilable after new parent renewals are closed.
const create = async (id = oid) => {
  const o = {
    id,
    student_id: sid,
    package_type_id: pid,
    parent_id: "parent",
    student_name: "QA学生",
    package_name: "QA十课时",
    hours: 10,
    amount_cents: 80000,
    status: "pending",
    recipient: "QA",
    package_id:
      id === "33333333-3333-4333-8333-333333333333"
        ? "55555555-5555-4555-8555-555555555555"
        : "66666666-6666-4666-8666-666666666666",
    payment_id:
      id === "33333333-3333-4333-8333-333333333333"
        ? "77777777-7777-4777-8777-777777777777"
        : "88888888-8888-4888-8888-888888888888",
  };
  memory.set("private/renewals/orders", [...(memory.get("private/renewals/orders") || []), o]);
  memory.set("private/renewals/assets/" + id, { qr });
  return o;
};
const proof = () => call("parent", `/${oid}/proof`, "POST", { proof: qr, note: "QA付款" });
const confirm = () =>
  call("admin", `/${oid}/confirm`, "POST", {
    current_password: "qa-password",
    payment_reference: "QA123456",
    amount_cents: 80000,
  });
test("历史订单价格不变，提交凭证不写财务", async () => {
  const o = await create();
  assert.equal(o.amount_cents, 80000);
  assert.equal(o.hours, 10);
  db.get(`package_types/${pid}`).price_cents = 90000;
  await proof();
  assert.equal((await call("parent", `/${oid}`)).amount_cents, 80000);
  assert.equal(writes.length, 0);
  assert.equal(memory.get("private/renewals/orders")[0].qr, undefined);
});
test("管理员确认到账写课时与收款，重复确认不重复入账", async () => {
  await create();
  await proof();
  assert.equal((await confirm()).status, "confirmed");
  await confirm();
  assert.deepEqual(writes, ["student_packages", "package_payments"]);
  const pay = [...db.values()].find((x) => x.amount_cents === 80000 && x.method);
  assert.equal(pay.recorded_by, "admin");
});
test("收款写入中断后，同一订单恢复不重复增加课时", async () => {
  await create();
  await proof();
  failPayment = true;
  await assert.rejects(confirm);
  assert.equal((await call("admin", `/${oid}`)).status, "processing");
  await assert.rejects(() => call("parent", `/${oid}/cancel`, "POST"));
  await confirm();
  assert.deepEqual(writes, ["student_packages", "package_payments"]);
});
test("其他家长和老师无权查看订单，家长不能确认或修改收款设置", async () => {
  await create();
  await assert.rejects(() => call("parent", `/${oid}`, "GET", {}, "other"));
  assert.deepEqual(await call("parent", "/", "GET", {}, "other"), []);
  await assert.rejects(() => call("teacher", "/"));
  await assert.rejects(() => call("parent", `/${oid}/confirm`, "POST"));
  await assert.rejects(() => call("parent", "/config", "POST", {}));
  assert.equal(writes.length, 0);
});
test("金额不符、密码不正确、未提交付款均不能入账", async () => {
  await create();
  await assert.rejects(confirm);
  await proof();
  await assert.rejects(() =>
    call("admin", `/${oid}/confirm`, "POST", { current_password: "qa-password", amount_cents: 1 }),
  );
  await assert.rejects(() =>
    call("admin", `/${oid}/confirm`, "POST", { current_password: "bad", amount_cents: 80000 }),
  );
  assert.equal(writes.length, 0);
});
test("同一学员已有订单阻止重复下单，退回可重新提交，取消仅限待付款", async () => {
  await create();
  await assert.rejects(() =>
    call("parent", "/", "POST", {
      id: "44444444-4444-4444-8444-444444444444",
      student_id: sid,
      package_type_id: pid,
    }),
  );
  await proof();
  await assert.rejects(() => call("parent", `/${oid}/cancel`, "POST"));
  assert.equal(
    (await call("admin", `/${oid}/reject`, "POST", { reason: "凭证不清晰" })).status,
    "pending",
  );
  await proof();
  assert.equal((await call("admin", `/${oid}`)).status, "review");
});

test("同一微信交易单号不能给两笔订单入账", async () => {
  await create();
  await proof();
  await confirm();
  const second = "44444444-4444-4444-8444-444444444444";
  await create(second);
  await call("parent", "/" + second + "/proof", "POST", { proof: qr });
  await assert.rejects(
    () =>
      call("admin", "/" + second + "/confirm", "POST", {
        current_password: "qa-password",
        amount_cents: 80000,
        payment_reference: "QA123456",
      }),
    { code: "PAYMENT_ALREADY_USED" },
  );
  assert.deepEqual(writes, ["student_packages", "package_payments"]);
});

test("家长自助续费关闭后不能创建新订单", async () => {
  await assert.rejects(
    () => call("parent", "/", "POST", { id: oid, student_id: sid, package_type_id: pid }),
    { code: "RENEWAL_CLOSED" },
  );
  assert.equal(writes.length, 0);
});
