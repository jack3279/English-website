// v2 富 seed: 3 课程包类型 + 每学员 1 个包 + 一周排课
// 需先应用 supabase/migrations/20260912100001 等迁移
import { createClient } from "@supabase/supabase-js";

const url = "https://ueuerggzomryvisijdym.supabase.co";
const key = "sb_secret_iE0C8dfBQH4gWVbP8COrLg_7UNGlZ1m";
const c = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

(async () => {
  // 1. 课程包类型 (3 种)
  const pkgTypes = [
    { name: "30 课时包", hours: 30, price_cents: 300000 },
    { name: "60 课时包", hours: 60, price_cents: 580000 },
    { name: "100 课时包", hours: 100, price_cents: 900000 },
  ];
  for (const p of pkgTypes) {
    const { error } = await c.from("package_types").upsert(p, { onConflict: "name" });
    if (error) throw error;
  }
  console.log("  package_types:", pkgTypes.length);

  // 2. 拉现有学员和 2 个老师
  const { data: students, error: sErr } = await c.from("students").select("id, full_name");
  if (sErr) throw sErr;
  const { data: teachers, error: tErr } = await c
    .from("teachers")
    .select("id, profile_id, profiles!inner(full_name)");
  if (tErr) throw tErr;
  const emmaT = teachers.find((t) => t.profiles?.full_name === "Emma");
  const johnT = teachers.find((t) => t.profiles?.full_name === "John");
  const teachersById = { emma: emmaT?.profile_id, john: johnT?.profile_id };
  console.log("  students:", students.length, "teachers:", teachers.length);
  if (!emmaT && !johnT) {
    console.warn("  no emma/john teachers found, using first available");
  }

  // 3. 给每个学员分配 1 个 30 课时包 (remaining = 25)
  const { data: p1, error: pErr } = await c
    .from("package_types")
    .select("id, hours, name")
    .eq("name", "30 课时包")
    .single();
  if (pErr) throw pErr;
  for (const s of students) {
    const { error: insErr } = await c.from("student_packages").upsert(
      {
        student_id: s.id,
        package_type_id: p1.id,
        total_hours: p1.hours,
        remaining_hours: p1.hours - 5,
        notes: "初始包, 已用 5h",
      },
      { onConflict: "student_id,package_type_id" },
    );
    if (insErr) {
      console.warn("  student_package insert err for", s.full_name, insErr.message);
    }
  }
  console.log("  student_packages seeded for", students.length, "students");

  // 4. 一周排课 (周一至周五, 每天 1-2 节)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 从今天开始, 只排未来 5 天
  const baseDate = new Date(today);
  const studentSubset = students.slice(0, 6);
  let lessonCount = 0;
  for (let d = 0; d < 5; d++) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + d);
    for (let s = 0; s < studentSubset.length; s++) {
      const student = studentSubset[s];
      // 隔天排, 每天 16:00
      if ((d + s) % 2 === 1) continue;
      date.setHours(16, 0, 0, 0);
      const teacherKey = s % 2 === 0 ? "emma" : "john";
      const teacherId = teachersById[teacherKey] || teachers[0]?.profile_id;
      if (!teacherId) {
        console.warn("  no teacher id available, skipping lesson");
        continue;
      }
      const { error: lErr } = await c.from("lessons").insert({
        teacher_id: teacherId,
        student_id: student.id,
        scheduled_at: date.toISOString(),
        duration_min: 60,
        status: "scheduled",
      });
      if (lErr) {
        console.warn("  lesson insert err:", lErr.message);
      } else {
        lessonCount++;
      }
    }
  }
  console.log("  lessons seeded:", lessonCount, "lessons (5 days × ~3 students)");

  console.log("  done");
})().catch((e) => {
  console.error("TOP ERR:", e);
  process.exit(1);
});
