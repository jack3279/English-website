// e2e fixtures: 在 test 之前重置 DB + 灌 seed
// 用 service_role key 直接操作 Supabase PostgREST + Auth admin
const { createClient } = require("@supabase/supabase-js");

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 如果没 SERVICE_KEY, 让 fixtures 变成 no-op,
// test 仍可登录走真实 cloud 数据 (admin@17say.org)
const HAS_SERVICE = Boolean(SERVICE);
const admin = HAS_SERVICE
  ? createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const BRANCH = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Demo1234!";

async function ensureUser(email, fullName, role, extra = {}) {
  const { data: existing } = await admin.auth.admin.listUsers();
  let user = existing?.users?.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  await admin.from("profiles").upsert({
    id: user.id,
    role,
    full_name: fullName,
    branch_id: BRANCH,
    phone: extra.phone ?? null,
  });
  return user;
}

async function ensureStudent(fullName, birthDate) {
  const { data, error } = await admin
    .from("students")
    .insert({
      full_name: fullName,
      birth_date: birthDate,
      branch_id: BRANCH,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function ensureTeacher(profileId) {
  const { error } = await admin.from("teachers").insert({
    profile_id: profileId,
    specialties: "ESL, Phonics",
    default_rate: 200,
  });
  if (error && error.code !== "23505") throw error; // 23505 duplicate
}

async function ensureParent(profileId, fullName) {
  const { data, error } = await admin
    .from("parents")
    .insert({
      profile_id: profileId,
      full_name: fullName,
    })
    .select()
    .single();
  if (error && error.code !== "23505") throw error;
  return data;
}

async function link(parentId, studentId) {
  const { error } = await admin.from("parent_student_links").insert({
    parent_id: parentId,
    student_id: studentId,
    relation: "mother",
  });
  if (error && error.code !== "23505") throw error;
}

/**
 * 清掉 demo data + 重建. 测试间不互相影响.
 * 注意: supabase db reset 是干净的 (会重跑 migration), 但慢.
 * 这里用 truncate + reseed, 更快.
 */
async function resetAndSeed() {
  if (!HAS_SERVICE) {
    console.log(
      "  [fixtures] no SUPABASE_SERVICE_ROLE_KEY, skip reset+seed (test will use existing cloud data)",
    );
    return;
  }
  // 顺序很重要: 子表先清
  await admin.from("parent_feeds").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin
    .from("lesson_transactions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("lessons").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("courses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin
    .from("parent_student_links")
    .delete()
    .neq("parent_id", "00000000-0000-0000-0000-000000000000");
  await admin.from("parents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("teachers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("students").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("audit_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  // 不删 auth.users (supabase-js 删用户需要 admin API, 慢)
  // 直接重建 profile / parent / teacher / student 行

  const adminUser = await ensureUser("admin@17say.org", "机构管理员", "admin", {
    phone: "13800000001",
  });
  const teacher1 = await ensureUser("emma@17say.org", "Emma", "teacher", { phone: "13800000002" });
  const teacher2 = await ensureUser("john@17say.org", "John", "teacher", { phone: "13800000003" });
  const parent1 = await ensureUser("lilyparent@17say.org", "Lily 妈妈", "parent", {
    phone: "13800000004",
  });

  await ensureTeacher(teacher1.id);
  await ensureTeacher(teacher2.id);
  const p1Row = await ensureParent(parent1.id, "Lily 妈妈");

  const lily = await ensureStudent("Lily", "2018-05-10");
  await ensureStudent("Tom", "2017-03-22");
  await ensureStudent("Alice", "2016-11-01");
  await ensureStudent("Bob", "2018-08-15");
  await ensureStudent("Carol", "2015-09-09");
  await ensureStudent("David", "2019-01-30");

  await link(p1Row.id, lily.id);

  const { data: course, error: cErr } = await admin
    .from("courses")
    .insert({
      name: "Lily 一对一",
      teacher_id: teacher1.id,
      branch_id: BRANCH,
      weekday: 3,
      start_time: "08:00:00",
      duration_min: 60,
      student_id: lily.id,
      active: true,
    })
    .select()
    .single();
  if (cErr) throw cErr;

  // 7 节课: 本地 8:00 (today 永远命中)
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const at = new Date(now);
    at.setDate(at.getDate() + i);
    at.setHours(8, 0, 0, 0);
    await admin.from("lessons").insert({
      course_id: course.id,
      teacher_id: teacher1.id,
      student_id: lily.id,
      scheduled_at: at.toISOString(),
      duration_min: 60,
      status: "scheduled",
    });
  }

  // 6 个学员每个 30h
  for (const name of ["Lily", "Tom", "Alice", "Bob", "Carol", "David"]) {
    const { data: s } = await admin.from("students").select("id").eq("full_name", name).single();
    if (s) {
      await admin.from("lesson_transactions").insert({
        student_id: s.id,
        delta: 30,
        reason: "topup",
        note: "demo seed",
      });
    }
  }
}

module.exports = { resetAndSeed };
