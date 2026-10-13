// Isolated, mutable PostgREST fixture. Unknown query operations fail rather than
// silently returning canned success. The production v8 balance formula is used.
const { randomUUID } = require("node:crypto");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
class StatefulDb {
  constructor() {
    this.tables = {};
    this.writes = [];
    this.queries = [];
    this.failNext = null;
  }
  rows(t) {
    if (t === "student_balance")
      return this.rows("students").map((s) => ({
        student_id: s.id,
        remaining_hours: this.balance(s.id),
      }));
    return (this.tables[t] ||= []);
  }
  balance(id) {
    return (
      Math.round(
        (this.rows("student_packages")
          .filter((r) => r.student_id === id)
          .reduce((n, r) => n + Number(r.remaining_hours), 0) +
          this.rows("lesson_transactions")
            .filter((r) => r.student_id === id && ["consume", "adjust"].includes(r.reason))
            .reduce((n, r) => n + Number(r.delta), 0)) *
          100,
      ) / 100
    );
  }
  seed(t, rows) {
    this.tables[t] = structuredClone(rows);
  }
  insert(t, values) {
    if (this.failNext === t) {
      this.failNext = null;
      throw new Error("Injected storage failure");
    }
    const rows = (Array.isArray(values) ? values : [values]).map((v) => ({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      purchased_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      ...v,
    }));
    for (const r of rows) {
      if (this.rows(t).some((x) => x.id === r.id)) throw new Error("Duplicate primary key");
      if (t === "records" && this.rows(t).some((x) => x.lesson_id === r.lesson_id))
        throw new Error("Duplicate record");
      this.rows(t).push(r);
    }
    this.writes.push({ table: t, method: "POST", ids: rows.map((r) => r.id) });
    return rows;
  }
  relation(t, r) {
    const one = (name, id) => this.rows(name).find((x) => x.id === id) || null;
    return {
      ...r,
      ...(t === "parent_student_links" ? { parents: one("parents", r.parent_id) } : {}),
      ...(t === "student_packages"
        ? { package_types: one("package_types", r.package_type_id) }
        : {}),
      ...(t === "lessons"
        ? {
            students: one("students", r.student_id),
            profiles: one("profiles", r.teacher_id),
            courses: one("courses", r.course_id),
          }
        : {}),
    };
  }
  client() {
    const db = this;
    return {
      from: (t) => db.query(t),
      auth: {
        getUser: async () => ({ data: { user: { id: uuid(1), email: "qa@example.invalid" } } }),
        signInWithPassword: async () => ({ data: { user: { id: uuid(1) } } }),
        signOut: async () => ({}),
      },
    };
  }
  query(t) {
    const db = this,
      filters = [],
      orders = [];
    let start = 0,
      end = Infinity,
      single = false,
      mutation = null,
      values = null,
      executed = null;
    const value = (row, key) => key.split(".").reduce((v, k) => v?.[k], row);
    const cmp = (r, key, op, v) => {
      const a = value(db.relation(t, r), key);
      return op === "eq"
        ? String(a) === String(v)
        : op === "neq"
          ? String(a) !== String(v)
          : op === "in"
            ? v.includes(a)
            : op === "gte"
              ? a >= v
              : op === "lte"
                ? a <= v
                : op === "gt"
                  ? a > v
                  : op === "lt"
                    ? a < v
                    : op === "is"
                      ? a === v
                      : false;
    };
    const q = {
      select() {
        return q;
      },
      order(k, o = {}) {
        orders.push([k, o.ascending !== false]);
        return q;
      },
      range(a, b) {
        start = a;
        end = b;
        return q;
      },
      limit(n) {
        end = start + n - 1;
        return q;
      },
      single() {
        single = true;
        return q;
      },
      maybeSingle() {
        single = true;
        return q;
      },
      insert(v) {
        mutation = "POST";
        values = v;
        return q;
      },
      update(v) {
        mutation = "PATCH";
        values = v;
        return q;
      },
      delete() {
        mutation = "DELETE";
        return q;
      },
      or(expr) {
        const clauses = expr.split(",").map((c) => c.split("."));
        filters.push((r) => clauses.some(([k, op, ...v]) => cmp(r, k, op, v.join("."))));
        return q;
      },
      then(resolve, reject) {
        if (!executed)
          executed = Promise.resolve().then(() => {
            try {
              db.queries.push({ table: t, start, end });
              let rows = db.rows(t).filter((r) => filters.every((f) => f(r)));
              if (mutation === "POST") rows = db.insert(t, values);
              else if (mutation === "PATCH") {
                for (const r of rows) Object.assign(r, values);
                db.writes.push({ table: t, method: mutation, ids: rows.map((r) => r.id) });
              } else if (mutation === "DELETE") {
                const ids = new Set(rows.map((r) => r.id));
                db.tables[t] = db.rows(t).filter((r) => !ids.has(r.id));
              }
              for (const [k, asc] of orders.slice().reverse())
                rows = [...rows].sort(
                  (a, b) => String(a[k]).localeCompare(String(b[k])) * (asc ? 1 : -1),
                );
              const count = rows.length;
              rows = rows
                .slice(start, end === Infinity ? undefined : end + 1)
                .map((r) => db.relation(t, r));
              return { data: single ? rows[0] || null : structuredClone(rows), count, error: null };
            } catch (error) {
              return { data: null, error };
            }
          });
        return executed
          .then(async (result) => {
            if (db.readDelay?.table === t && !mutation)
              await new Promise((r) => setTimeout(r, db.readDelay.ms));
            return result;
          })
          .then(resolve, reject);
      },
    };
    for (const op of ["eq", "neq", "in", "gte", "lte", "gt", "lt", "is"])
      q[op] = (k, v) => {
        filters.push((r) => cmp(r, k, op, v));
        return q;
      };
    return q;
  }
  async fetch(url, options = {}) {
    const u = new URL(url);
    if (u.hostname !== "stateful.invalid")
      throw new Error(`Unexpected network request: ${u.hostname}`);
    const t = u.pathname.split("/").pop(),
      q = this.query(t);
    for (const [k, v] of u.searchParams) {
      if (k === "select") continue;
      if (k === "order") {
        q.order(v.split(".")[0], { ascending: !v.endsWith(".desc") });
        continue;
      }
      if (k === "limit") {
        q.limit(Number(v));
        continue;
      }
      const [op, ...rest] = v.split(".");
      if (!q[op]) throw new Error(`Unsupported raw filter ${op}`);
      q[op](k, rest.join("."));
    }
    if (options.method === "POST") q.insert(JSON.parse(options.body));
    if (options.method === "PATCH") q.update(JSON.parse(options.body));
    if (options.method === "DELETE") q.delete();
    const r = await q;
    return {
      ok: !r.error,
      status: r.error ? 503 : 200,
      text: async () => (r.error ? String(r.error) : JSON.stringify(r.data)),
    };
  }
}
class Bucket {
  constructor() {
    this.files = new Map();
    this.version = 0;
  }
  async get(k) {
    const o = this.files.get(k);
    return o ? { etag: o.etag, json: async () => JSON.parse(o.data) } : null;
  }
  async put(k, data, options) {
    const old = this.files.get(k);
    if (options?.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
    if (options?.onlyIf?.get?.("If-None-Match") === "*" && old) return null;
    const o = { data, etag: String(++this.version) };
    this.files.set(k, o);
    return o;
  }
}
function generate() {
  const db = new StatefulDb(),
    teachers = [],
    profiles = [{ id: uuid(1), role: "admin", full_name: "MOCK管理员" }],
    students = [],
    parents = [],
    links = [],
    courses = [],
    lessons = [],
    packs = [],
    payments = [],
    txs = [],
    records = [],
    feeds = [];
  for (let i = 0; i < 12; i++) {
    const p = { id: uuid(100 + i), role: "teacher", full_name: `MOCK Teacher ${i + 1}` };
    profiles.push(p);
    teachers.push({
      id: uuid(200 + i),
      profile_id: p.id,
      hourly_pay: i % 3 === 0 ? 400 : i % 3 === 1 ? 15 : 20,
      pay_currency: ["PHP", "USD", "EUR"][i % 3],
      active: true,
    });
  }
  for (let i = 0; i < 80; i++) {
    profiles.push({ id: uuid(300 + i), role: "parent", full_name: `MOCK家长${i + 1}` });
    parents.push({ id: uuid(500 + i), profile_id: uuid(300 + i) });
  }
  for (let i = 0; i < 120; i++) {
    const s = { id: uuid(1000 + i), full_name: `MOCK学生${i + 1}`, status: "active" },
      teacher = teachers[i % 12];
    students.push(s);
    links.push({ id: uuid(2000 + i), student_id: s.id, parent_id: parents[i % 80].id });
    const c = {
      id: uuid(3000 + i),
      student_id: s.id,
      teacher_id: teacher.profile_id,
      name: `MOCK课程${(i % 4) + 1}`,
      status: "active",
    };
    courses.push(c);
    packs.push({
      id: uuid(4000 + i),
      student_id: s.id,
      package_type_id: uuid(2),
      total_hours: 100,
      remaining_hours: 100,
      purchased_at: "2026-09-01T01:00:00Z",
    });
    payments.push({
      id: uuid(5000 + i),
      student_id: s.id,
      student_package_id: uuid(4000 + i),
      amount_cents: 800000,
      paid_at: "2026-09-01T01:00:00Z",
    });
    for (let j = 0; j < 14; j++) {
      const duration = [30, 45, 60, 90][j % 4],
        done = j < 12,
        l = {
          id: uuid(10000 + i * 20 + j),
          student_id: s.id,
          teacher_id: teacher.profile_id,
          course_id: c.id,
          duration_min: duration,
          scheduled_at: `2026-10-${String(j < 12 ? 1 + (j % 9) : 10).padStart(2, "0")}T${String(1 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
          status: done ? "completed" : "scheduled",
          ...(done
            ? { pay_rate: teacher.hourly_pay, pay_amount: (teacher.hourly_pay * duration) / 60 }
            : {}),
        };
      lessons.push(l);
      if (done) {
        const rec = {
          id: uuid(50000 + i * 20 + j),
          lesson_id: l.id,
          content: "MOCK课程记录",
          performance: "MOCK练习",
          homework: "",
          next_plan: "",
        };
        records.push(rec);
        feeds.push({
          id: uuid(70000 + i * 20 + j),
          record_id: rec.id,
          student_id: s.id,
          summary: "MOCK已完成",
          published_at: l.scheduled_at,
        });
        txs.push({
          id: uuid(90000 + i * 20 + j),
          student_id: s.id,
          lesson_id: l.id,
          delta: -duration / 60,
          reason: "consume",
          created_at: l.scheduled_at,
        });
      }
    }
  }
  for (const [t, rows] of Object.entries({
    teachers,
    profiles,
    students,
    parents,
    parent_student_links: links,
    courses,
    lessons,
    student_packages: packs,
    package_payments: payments,
    lesson_transactions: txs,
    records,
    parent_feeds: feeds,
    package_types: [
      { id: uuid(2), name: "MOCK十课时", hours: 10, price_cents: 80000, active: true },
    ],
  }))
    db.seed(t, rows);
  return db;
}
module.exports = { StatefulDb, Bucket, generate, uuid };
