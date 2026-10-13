import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required");
  process.exit(1);
}
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
  const { error: pErr } = await admin.from("profiles").upsert({
    id: user.id,
    role,
    full_name: fullName,
    branch_id: BRANCH,
    phone: extra.phone ?? null,
  });
  if (pErr) throw pErr;
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
  const { data, error } = await admin
    .from("teachers")
    .insert({
      profile_id: profileId,
      specialties: "ESL, Phonics",
      // 课酬单价(元/小时)。不用历史字段 default_rate(单位存疑, 已弃用)。
      hourly_pay: 200,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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
  if (error) throw error;
  return data;
}

async function link(parentId, studentId) {
  const { error } = await admin.from("parent_student_links").insert({
    parent_id: parentId,
    student_id: studentId,
    relation: "mother",
  });
  if (error && error.code !== "23505") throw error; // 23505 duplicate key ok
}

(async () => {
  // 1. users
  const adminUser = await ensureUser("admin@17say.org", "机构管理员", "admin", {
    phone: "13800000001",
  });
  const teacher1 = await ensureUser("emma@17say.org", "Emma", "teacher", { phone: "13800000002" });
  const teacher2 = await ensureUser("john@17say.org", "John", "teacher", { phone: "13800000003" });
  const parent1 = await ensureUser("lilyparent@17say.org", "Lily 妈妈", "parent", {
    phone: "13800000004",
  });

  // 2. teacher / parent rows
  await ensureTeacher(teacher1.id);
  await ensureTeacher(teacher2.id);
  const p1Row = await ensureParent(parent1.id, "Lily 妈妈");

  // 3. students
  const lily = await ensureStudent("Lily", "2018-05-10");
  const tom = await ensureStudent("Tom", "2017-03-22");
  const alice = await ensureStudent("Alice", "2016-11-01");
  const bob = await ensureStudent("Bob", "2018-08-15");
  const carol = await ensureStudent("Carol", "2015-09-09");
  const david = await ensureStudent("David", "2019-01-30");

  // 4. parent ↔ student
  await link(p1Row.id, lily.id);

  // 5. course
  const { data: course, error: cErr } = await admin
    .from("courses")
    .insert({
      name: "Lily 一对一",
      teacher_id: teacher1.id,
      branch_id: BRANCH,
      weekday: 3,
      start_time: "16:00:00",
      duration_min: 60,
      student_id: lily.id,
      active: true,
    })
    .select()
    .single();
  if (cErr) throw cErr;

  // 6. 未来 7 天每天一节 (本地 8:00 排课, 保证 today 永远命中)
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

  // 7. 每个学员先 topup 30h
  for (const s of [lily, tom, alice, bob, carol, david]) {
    await admin.from("lesson_transactions").insert({
      student_id: s.id,
      delta: 30,
      reason: "topup",
      note: "demo seed",
    });
  }

  console.log("Seed complete:");
  console.log("  admin@17say.org / Demo1234!");
  console.log("  emma@17say.org / Demo1234!");
  console.log("  john@17say.org / Demo1234!");
  console.log("  lilyparent@17say.org / Demo1234!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
