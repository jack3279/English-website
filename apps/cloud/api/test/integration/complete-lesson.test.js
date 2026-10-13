// 端到端集成测试: 完课核心流程
// 需 supabase start 运行中, demo 数据已 seed
const test = require("node:test");
const assert = require("node:assert/strict");

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { createClient } = require("@supabase/supabase-js");

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 直接调 handler (需要先建 req/res mock 注入 supabase 单例)
const { applyMiddleware } = require("../helpers.js");
const schedulesRaw = require("../../routes/schedules.js");
const lessonsRaw = require("../../routes/lessons.js");
const { withErrorHandler } = require("../../lib/errors.js");

const _schedules = withErrorHandler(schedulesRaw);
const lessons = withErrorHandler(lessonsRaw);

async function loginAs(email, password) {
  const { data, error } = await admin.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

async function callHandler(handler, method, url, body, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const { req, res } = applyMiddleware({ method, url, body, headers });
  await handler(req, res);
  return { status: res._captured.statusCode, body: res._captured.body };
}

test("完课核心: teacher 完成一节课 → 扣时 + record + parent_feed + audit", async (_t) => {
  if (!SERVICE) {
    _t.skip("SUPABASE_SERVICE_ROLE_KEY not set");
    return;
  }

  const teacherToken = await loginAs("emma@17say.org", "Demo1234!");

  // 1. 找一个 scheduled 状态的课
  const { data: scheduledLessons } = await admin
    .from("lessons")
    .select("id, student_id, status")
    .eq("status", "scheduled")
    .limit(1);
  if (!scheduledLessons || scheduledLessons.length === 0) {
    _t.skip("no scheduled lessons (run seed-users.mjs first)");
    return;
  }
  const lesson = scheduledLessons[0];

  // 2. 拿改前的余额
  const { data: balBefore } = await admin
    .from("student_balance")
    .select("remaining_hours")
    .eq("student_id", lesson.student_id)
    .single();
  const before = Number(balBefore?.remaining_hours ?? 0);

  // 3. POST /api/lessons/:id/complete
  const res = await callHandler(
    lessons,
    "POST",
    `/${lesson.id}/complete`,
    {
      content: "今天学 Unit 5",
      performance: "积极参与",
      homework: "WB P23",
      next_plan: "Unit 6",
      publishToParent: true,
    },
    teacherToken,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.lessonId, lesson.id);
  assert.equal(res.body.data.parentFeedPublished, true);
  assert.equal(res.body.data.newBalance, before - 1);

  // 4. 验证数据库
  const { data: updated } = await admin
    .from("lessons")
    .select("status, completed_at")
    .eq("id", lesson.id)
    .single();
  assert.equal(updated.status, "completed");
  assert.ok(updated.completed_at);

  const { data: txs } = await admin
    .from("lesson_transactions")
    .select("delta, reason")
    .eq("lesson_id", lesson.id);
  assert.equal(txs.length, 1);
  assert.equal(Number(txs[0].delta), -1);
  assert.equal(txs[0].reason, "consume");

  const { data: feeds } = await admin
    .from("parent_feeds")
    .select("summary, student_id")
    .eq("record_id", res.body.data.recordId);
  assert.equal(feeds.length, 1);

  const { data: audits } = await admin
    .from("audit_log")
    .select("action, target_id")
    .eq("action", "lesson.complete")
    .eq("target_id", lesson.id);
  assert.ok(audits.length >= 1);
});

test("完课核心: 重复 complete 同一课次 → 409", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const teacherToken = await loginAs("emma@17say.org", "Demo1234!");

  // 找一个已 completed 的课
  const { data: completedOnes } = await admin
    .from("lessons")
    .select("id, student_id")
    .eq("status", "completed")
    .limit(1);
  if (!completedOnes || completedOnes.length === 0) {
    _t.skip("no completed lessons");
    return;
  }
  const res = await callHandler(
    lessons,
    "POST",
    `/${completedOnes[0].id}/complete`,
    {
      content: "x",
      performance: "",
      homework: "",
      next_plan: "",
      publishToParent: false,
    },
    teacherToken,
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "LESSON_ALREADY_COMPLETED");
});

test("完课核心: teacher 完成别人的课 → 403", async (_t) => {
  if (!SERVICE) {
    _t.skip("no SERVICE key");
    return;
  }
  const emmaToken = await loginAs("emma@17say.org", "Demo1234!");

  // 直接找 john 的 scheduled 课
  const { data: johnLessonsList } = await admin
    .from("lessons")
    .select("id, status, profiles:teacher_id (id, full_name)")
    .eq("status", "scheduled")
    .limit(5);
  const john = johnLessonsList?.find((l) => l.profiles?.full_name === "John");
  if (!john) {
    _t.skip("no john lessons");
    return;
  }

  const res = await callHandler(
    lessons,
    "POST",
    `/${john.id}/complete`,
    {
      content: "x",
      performance: "",
      homework: "",
      next_plan: "",
      publishToParent: false,
    },
    emmaToken,
  );
  assert.equal(res.status, 403);
});

test("完课核心: 缺 token → 401", async (_t) => {
  const res = await callHandler(lessons, "POST", "/00000000-0000-0000-0000-000000000000/complete", {
    content: "x",
    performance: "",
    homework: "",
    next_plan: "",
    publishToParent: false,
  });
  assert.equal(res.status, 401);
});
