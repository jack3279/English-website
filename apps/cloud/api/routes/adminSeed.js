// /seed-demo: create demo data (admin only)
const { ok, forbidden } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { record: audit } = require("../lib/audit.js");

const TEACHERS = [
  {
    email: "alice.t@17say.org",
    full_name: "Alice 老师",
    specialties: ["kids", "beginner"],
    hourly_pay: 250,
  },
  {
    email: "bob.t@17say.org",
    full_name: "Bob 老师",
    specialties: ["teens", "business"],
    hourly_pay: 300,
  },
  {
    email: "carol.t@17say.org",
    full_name: "Carol 老师",
    specialties: ["kids", "phonics"],
    hourly_pay: 220,
  },
];
const PARENTS = [
  { email: "david.p@17say.org", full_name: "David 爸爸", child: "David Jr" },
  { email: "emma.p@17say.org", full_name: "Emma 妈妈", child: "Emma Jr" },
];
const PASSWORD = "Demo1234!";
const BRANCH = "00000000-0000-0000-0000-000000000001";

async function fetchRaw(table, method, body, query = "") {
  const env = globalThis.__CLOUDFLARE_ENV || process.env;
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query}`;
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`raw ${table} ${method} failed: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function ensureUser(email, full_name, role, extra = {}) {
  const env = globalThis.__CLOUDFLARE_ENV || process.env;
  const listR = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!listR.ok) throw new Error(`listUsers ${listR.status} ${(await listR.text()).slice(0, 200)}`);
  const list = (await listR.json()) ?? {};
  const users = Array.isArray(list) ? list : (list.users ?? []);
  let user = users.find((u) => u.email === email);
  if (!user) {
    const createR = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name, role, ...extra },
      }),
    });
    if (!createR.ok)
      throw new Error(
        `createUser ${email} ${createR.status} ${(await createR.text()).slice(0, 200)}`,
      );
    user = await createR.json();
  }
  await fetchRaw("profiles", "POST", {
    id: user.id,
    full_name,
    role,
    branch_id: BRANCH,
    phone: extra.phone ?? null,
  });
  return user;
}

async function ensureTeacher(profileId, fullName, specialties, hourlyPay) {
  const existing = await fetchRaw(
    "teachers",
    "GET",
    null,
    `?select=id,profile_id&profile_id=eq.${profileId}`,
  );
  if (Array.isArray(existing) && existing.length > 0) return existing[0];
  const rows = await fetchRaw("teachers", "POST", {
    profile_id: profileId,
    specialties: Array.isArray(specialties) ? specialties.join(", ") : specialties,
    hourly_pay: hourlyPay,
    active: true,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function ensureParent(profileId, fullName) {
  const rows = await fetchRaw(
    "parents",
    "GET",
    null,
    `?select=id,profile_id&profile_id=eq.${profileId}`,
  );
  if (Array.isArray(rows) && rows.length > 0) return rows[0];
  const created = await fetchRaw("parents", "POST", { profile_id: profileId, full_name: fullName });
  return Array.isArray(created) ? created[0] : created;
}

async function ensureStudent(full_name, birth_date, branch_id, notes = null) {
  const rows = await fetchRaw(
    "students",
    "GET",
    null,
    `?select=id,full_name&full_name=eq.${encodeURIComponent(full_name)}`,
  );
  if (Array.isArray(rows) && rows.length > 0) return rows[0];
  const created = await fetchRaw("students", "POST", {
    full_name,
    birth_date,
    branch_id,
    status: "active",
    notes,
  });
  return Array.isArray(created) ? created[0] : created;
}

async function ensureSchedule(fields) {
  const dupeQ = `?select=id&teacher_id=eq.${fields.teacher_id}&student_id=eq.${fields.student_id}&scheduled_at=eq.${encodeURIComponent(fields.scheduled_at)}`;
  const existing = await fetchRaw("lessons", "GET", null, dupeQ);
  if (Array.isArray(existing) && existing.length > 0) return existing[0];
  const rows = await fetchRaw("lessons", "POST", fields);
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = async function handler(req, res) {
  try {
    await requireAuth(req, res);
    requireRole(req, res, "admin");
    if (req.method !== "POST") {
      forbidden(res, "POST only");
      return;
    }

    const result = { teachers: [], parents: [], students: [], lessons: [] };

    console.log("seed: start, admin ok");

    // 1. teacher users
    for (const t of TEACHERS) {
      const u = await ensureUser(t.email, t.full_name, "teacher");
      const tRow = await ensureTeacher(u.id, t.full_name, t.specialties, t.hourly_pay);
      result.teachers.push({ email: t.email, profile_id: u.id, teacher_id: tRow.id });
    }

    // 2. parents + students + links
    const createdStudentIds = [];
    for (const p of PARENTS) {
      const stu = await ensureStudent(p.child, "2017-06-15", BRANCH, "test student");
      result.students.push({ name: p.child, id: stu.id });
      createdStudentIds.push(stu.id);
      const u = await ensureUser(p.email, p.full_name, "parent");
      const parentRow = await ensureParent(u.id, p.full_name);
      const linkExist = await fetchRaw(
        "parent_student_links",
        "GET",
        null,
        `?select=parent_id&parent_id=eq.${parentRow.id}&student_id=eq.${stu.id}`,
      );
      if (!Array.isArray(linkExist) || linkExist.length === 0) {
        await fetchRaw("parent_student_links", "POST", {
          parent_id: parentRow.id,
          student_id: stu.id,
        });
      }
      result.parents.push({ email: p.email, id: u.id, child: p.child });
    }

    // 2.5 清理之前 seed 创的 lesson_transactions + records + parent_feeds (避免余额 -10)
    if (createdStudentIds.length && result.teachers.length) {
      const sIds2 = createdStudentIds.join(",");
      const tIds2 = result.teachers.map((t) => t.teacher_id).join(",");
      const demoLessons = await fetchRaw(
        "lessons",
        "GET",
        null,
        `?select=id&teacher_id=in.(${tIds2})&student_id=in.(${sIds2})`,
      );
      const lessonIds = (Array.isArray(demoLessons) ? demoLessons : [])
        .map((l) => l.id)
        .filter(Boolean);
      await fetchRaw("parent_feeds", "DELETE", null, `?student_id=in.(${sIds2})`);
      if (lessonIds.length > 0) {
        await fetchRaw("records", "DELETE", null, `?lesson_id=in.(${lessonIds.join(",")})`);
      }
      await fetchRaw("lesson_transactions", "DELETE", null, `?student_id=in.(${sIds2})`);
      console.log("seed: cleared old demo tx/records/feeds, lessonIds:", lessonIds.length);
    }

    const alice = { id: result.teachers[0].teacher_id, profile_id: result.teachers[0].profile_id };
    const bob = { id: result.teachers[1].teacher_id, profile_id: result.teachers[1].profile_id };
    const carol = { id: result.teachers[2].teacher_id, profile_id: result.teachers[2].profile_id };

    async function addLesson({
      teacherRow,
      studentId,
      when,
      status = "scheduled",
      record = null,
      tx = null,
    }) {
      const fields = {
        teacher_id: teacherRow.profile_id,
        student_id: studentId,
        scheduled_at: when,
        duration_min: 60,
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      };
      const less = await ensureSchedule(fields);
      if (record) {
        const existingRec = await fetchRaw(
          "records",
          "GET",
          null,
          `?select=id&lesson_id=eq.${less.id}`,
        );
        if (Array.isArray(existingRec) && existingRec.length > 0) {
          result.lessons.push({
            id: less.id,
            status,
            when,
            student: studentId,
            teacher: teacherRow.id,
          });
          return;
        }
        const recs = await fetchRaw("records", "POST", {
          lesson_id: less.id,
          ...record,
          created_by: teacherRow.profile_id,
        });
        const rec = Array.isArray(recs) ? recs[0] : recs;
        if (tx) {
          await fetchRaw("lesson_transactions", "POST", {
            student_id: studentId,
            lesson_id: less.id,
            delta: tx.delta,
            reason: tx.reason,
            note: tx.note ?? null,
            created_by: teacherRow.profile_id,
          });
        }
        if (tx?.publishToParent) {
          await fetchRaw("parent_feeds", "POST", {
            student_id: studentId,
            record_id: rec.id,
            summary: tx.note ?? "lesson done",
            published_at: new Date().toISOString(),
          });
        }
      }
      result.lessons.push({
        id: less.id,
        status,
        when,
        student: studentId,
        teacher: teacherRow.id,
      });
    }

    // 3. 给每个 demo 学生 1 个 30h 包
    for (const stu of result.students) {
      await fetchRaw("student_packages", "POST", {
        student_id: stu.id,
        package_type_id: null,
        total_hours: 30,
        remaining_hours: 30,
        notes: "demo seed package",
      });
    }
    console.log("seed: created student_packages for", result.students.length, "students");

    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 3600_000);
    tomorrow.setHours(10, 0, 0, 0);
    const day2 = new Date(today.getTime() + 2 * 24 * 3600_000);
    day2.setHours(15, 30, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 3600_000);
    yesterday.setHours(16, 0, 0, 0);
    const day3 = new Date(today.getTime() + 3 * 24 * 3600_000);
    day3.setHours(9, 0, 0, 0);

    // 1) completed with feedback
    await addLesson({
      teacherRow: alice,
      studentId: result.students[0].id,
      when: yesterday.toISOString(),
      status: "completed",
      record: {
        content: "Student was active, raised hand to answer questions",
        performance: "excellent",
        homework: "Review Lesson 3 vocabulary, write 3 times",
        next_plan: "Lesson 4 continue with present continuous tense",
      },
      tx: {
        delta: -1,
        reason: "consume",
        note: "Lesson 3 - student answered 12 questions, read after teacher 5 times",
        publishToParent: true,
      },
    });
    // 2-5) future
    await addLesson({
      teacherRow: alice,
      studentId: result.students[0].id,
      when: new Date(today.getTime() + 4 * 3600_000).toISOString(),
    });
    await addLesson({
      teacherRow: bob,
      studentId: result.students[1].id,
      when: tomorrow.toISOString(),
    });
    await addLesson({
      teacherRow: alice,
      studentId: result.students[0].id,
      when: day2.toISOString(),
    });
    await addLesson({
      teacherRow: carol,
      studentId: result.students[1].id,
      when: day3.toISOString(),
    });

    await audit(
      req.context.userId,
      "admin.seed_demo",
      "admin",
      null,
      {
        teachers: result.teachers.length,
        parents: result.parents.length,
        students: result.students.length,
        lessons: result.lessons.length,
      },
      req.reqId,
    );

    ok(res, { ok: true, password: PASSWORD, ...result });
  } catch (e) {
    console.error("seed: error", e?.message, e?.stack?.slice(0, 500));
    throw e;
  }
};
