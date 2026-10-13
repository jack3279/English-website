const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMiddleware } = require("../helpers.js");
const { withErrorHandler } = require("../../lib/errors.js");

const handlerRaw = require("../../routes/parent.js");
const ceRaw = require("../../routes/clientErrors.js");

const handler = withErrorHandler(handlerRaw);
const ce = withErrorHandler(ceRaw);

const URL_ = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { createClient } = require("@supabase/supabase-js");
const admin = createClient(URL_, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginAs(email, password) {
  const { data, error } = await admin.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

async function callHandler(h, method, url, body, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const { req, res } = applyMiddleware({ method, url, body, headers });
  await h(req, res);
  return { status: res._captured.statusCode, body: res._captured.body };
}

test("parent feeds 缺 token → 401", async () => {
  const r = await callHandler(
    handler,
    "GET",
    "/feeds?studentId=00000000-0000-0000-0000-000000000000",
  );
  assert.equal(r.status, 401);
});

test("parent upcoming 缺 token → 401", async () => {
  const r = await callHandler(handler, "GET", "/lessons/upcoming");
  assert.equal(r.status, 401);
});

test("parent leave 缺 token → 401", async () => {
  const r = await callHandler(
    handler,
    "POST",
    "/lessons/00000000-0000-0000-0000-000000000000/leave",
    { reason: "x" },
  );
  assert.equal(r.status, 401);
});

test("parent feeds 拿自己孩子的反馈", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const token = await loginAs("lilyparent@17say.org", "Demo1234!");

  // 找 Lily
  const { data: students } = await admin
    .from("students")
    .select("id, full_name")
    .eq("full_name", "Lily")
    .limit(1);
  if (!students || students.length === 0) {
    _t.skip("no Lily");
    return;
  }
  const lily = students[0];

  const r = await callHandler(handler, "GET", `/feeds?studentId=${lily.id}`, null, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.data));
});

test("parent upcoming 拿未来 7 天的课", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const token = await loginAs("lilyparent@17say.org", "Demo1234!");
  const r = await callHandler(handler, "GET", "/lessons/upcoming", null, token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
});

test("parent leave 提交请假", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const token = await loginAs("lilyparent@17say.org", "Demo1234!");

  // 找一个 Lily 的 scheduled 课
  const { data: lessons } = await admin
    .from("lessons")
    .select("id, status, leave_status")
    .eq("status", "scheduled")
    .is("leave_status", null)
    .limit(1);
  if (!lessons || lessons.length === 0) {
    _t.skip("no scheduled lessons");
    return;
  }
  const lesson = lessons[0];

  const r = await callHandler(
    handler,
    "POST",
    `/lessons/${lesson.id}/leave`,
    { reason: "感冒发烧" },
    token,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.leave_status, "pending");
  assert.match(r.body.data.leave_reason, /感冒/);
});

test("parent leave 无效 reason → 400", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const token = await loginAs("lilyparent@17say.org", "Demo1234!");
  const r = await callHandler(
    handler,
    "POST",
    "/lessons/00000000-0000-0000-0000-000000000000/leave",
    { reason: "" },
    token,
  );
  assert.equal(r.status, 400);
});

test("client-errors 写 audit_log", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const r = await callHandler(ce, "POST", "/", {
    message: "test err",
    url: "http://x",
    userAgent: "jest",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.recorded, true);
  // 验证 audit_log 有 client.error
  const { data } = await admin
    .from("audit_log")
    .select("action")
    .eq("action", "client.error")
    .order("created_at", { ascending: false })
    .limit(1);
  assert.ok(data && data.length > 0);
});
