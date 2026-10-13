// 丰富 demo 数据: 多家长绑多学员, 几节 completed lessons + parent_feeds
// 让 dashboard 有"今日已完成 > 0"和真实 H5 内容
import { createClient } from "@supabase/supabase-js";

const url = "https://ueuerggzomryvisijdym.supabase.co";
const serviceKey = "sb_secret_iE0C8dfBQH4gWVbP8COrLg_7UNGlZ1m";
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "Demo1234!";
const BRANCH = "00000000-0000-0000-0000-000000000001";

async function ensureUser(email, fullName, role, phone) {
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
    phone,
  });
  return user;
}

async function ensureParent(profileId, fullName) {
  const { data, error } = await admin
    .from("parents")
    .upsert(
      {
        profile_id: profileId,
        full_name: fullName,
      },
      { onConflict: "profile_id" },
    )
    .select()
    .single();
  if (error && error.code !== "23505") throw error;
  if (data) return data;
  const { data: r2 } = await admin.from("parents").select("*").eq("profile_id", profileId).single();
  return r2;
}

async function link(parentId, studentId) {
  const { error } = await admin.from("parent_student_links").insert({
    parent_id: parentId,
    student_id: studentId,
    relation: "mother",
  });
  if (error && error.code !== "23505") throw error;
}

(async () => {
  console.log("--- 1. 拉现有 students ---");
  const { data: students } = await admin.from("students").select("id, full_name");
  const studentMap = Object.fromEntries((students ?? []).map((s) => [s.full_name, s.id]));

  console.log("--- 2. 建 3 个新家长 (Tom/Alice/Bob 的妈妈) ---");
  const parents = [
    { email: "tomparent@17say.org", name: "Tom 妈妈", phone: "13900000001" },
    { email: "aliceparent@17say.org", name: "Alice 妈妈", phone: "13900000002" },
    { email: "bobparent@17say.org", name: "Bob 妈妈", phone: "13900000003" },
  ];
  for (const p of parents) {
    const user = await ensureUser(p.email, p.name, "parent", p.phone);
    const parent = await ensureParent(user.id, p.name);
    console.log(`  ${p.name} (parent_id=${parent.id})`);
  }

  console.log("--- 3. 绑 3 个家长 ↔ 学员 ---");
  const linkRes = await admin.from("parent_student_links").select("*");
  // 上面返的 existing links; 简单做法: 直接 upsert link
  for (const [parentEmail, studentName] of [
    ["tomparent@17say.org", "Tom"],
    ["aliceparent@17say.org", "Alice"],
    ["bobparent@17say.org", "Bob"],
  ]) {
    const { data: u } = await admin.auth.admin.listUsers();
    const pUser = u.users.find((x) => x.email === parentEmail);
    const { data: pr } = await admin
      .from("parents")
      .select("id")
      .eq("profile_id", pUser.id)
      .single();
    const sId = studentMap[studentName];
    await link(pr.id, sId);
    console.log(`  ${parentEmail} -> ${studentName} ✓`);
  }

  console.log("--- 4. 几节 completed lessons (今天早些时候) ---");
  // teacher 行已存在 (seed 阶段建的), 用 service_role 读
  const { data: existingT } = await admin.from("teachers").select("id, profile_id");
  if (!existingT || existingT.length === 0) {
    console.log("  no teacher rows, skip");
  } else {
    // 找 emma 老师
    const { data: userList } = await admin.auth.admin.listUsers();
    const emmaP = userList.users.find((u) => u.email === "emma@17say.org");
    const emmaT = existingT.find((t) => t.profile_id === emmaP.id) || existingT[0];
    // lessons.teacher_id 引用 profiles.id, 用 emmaT.profile_id (不是 teachers.id)
    const teacherId = emmaT.profile_id;
    console.log("  teacher profile_id (lesson.teacher_id 引用):", teacherId);
    {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const slots = [9, 11, 14];
      for (const h of slots) {
        const at = new Date(todayStart);
        at.setHours(h, 0, 0, 0);
        const studentName = ["Tom", "Alice", "Bob"][h === 9 ? 0 : h === 11 ? 1 : 2];
        const sId = studentMap[studentName];
        const lesson = {
          teacher_id: teacherId,
          student_id: sId,
          scheduled_at: at.toISOString(),
          duration_min: 60,
          status: "completed",
          completed_at: at.toISOString(),
        };
        const insRes = await admin.from("lessons").insert(lesson).select();
        if (insRes.error) {
          console.log("  insert err:", insRes.error.message, insRes.error.code);
          continue;
        }
        const inserted = insRes.data?.[0];
        if (!inserted) {
          console.log("  insert returned null");
          continue;
        }
        // record
        const { data: rec } = await admin
          .from("records")
          .insert({
            lesson_id: inserted.id,
            content: `${h === 9 ? "Unit 5" : h === 11 ? "Unit 6" : "Reading Practice"}`,
            performance: "表现良好, 积极参与",
            homework: "完成 Workbook P" + (h + 10),
            next_plan: "Unit " + (h + 1),
            created_by: teacherId,
          })
          .select()
          .single();
        // lesson_transaction
        await admin.from("lesson_transactions").insert({
          student_id: sId,
          lesson_id: inserted.id,
          delta: -1,
          reason: "consume",
          created_by: teacherId,
        });
        // parent_feed 给所有相关家长
        const { data: links } = await admin
          .from("parent_student_links")
          .select("parent_id")
          .eq("student_id", sId);
        for (const l of links ?? []) {
          await admin.from("parent_feeds").insert({
            record_id: rec.id,
            student_id: sId,
            summary: `${studentName} 今天学完了 ${rec.content}。表现良好, 请家长配合检查作业。`,
          });
        }
        console.log(`  ${h}:00  ${studentName}  ✓ complete`);
      }
    }
  }

  console.log("--- done ---");
})().catch((e) => {
  console.error("TOP ERR:", e);
  process.exit(1);
});
