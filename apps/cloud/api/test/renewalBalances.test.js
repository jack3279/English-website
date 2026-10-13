const test = require("node:test"),
  assert = require("node:assert/strict");
const { StatefulDb, uuid } = require("./support/statefulDb.js");
const { withStudentBalances, loadRenewalPackages } = require("../lib/renewalBalances.js");
const { pickRenewalAlerts } = require("../src/scheduled.js");
function fixture() {
  const db = new StatefulDb();
  db.seed("students", [{ id: uuid(1) }]);
  db.seed("student_packages", [
    {
      id: uuid(2),
      student_id: uuid(1),
      total_hours: 20,
      remaining_hours: 20,
      purchased_at: "2026-10-01T00:00:00Z",
    },
  ]);
  db.seed("lesson_transactions", [{ student_id: uuid(1), reason: "consume", delta: -18 }]);
  return db;
}
test("renewal warning uses post-attendance balance instead of unchanged package credit", async () => {
  const db = fixture();
  const packs = await withStudentBalances(db.client(), db.rows("student_packages"));
  const alerts = pickRenewalAlerts(packs);
  assert.equal(db.rows("student_packages")[0].remaining_hours, 20);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].balance, 2);
});
test("a renewal suppresses old-package low warnings and resets the dedupe key", async () => {
  const db = fixture();
  db.insert("student_packages", {
    id: uuid(3),
    student_id: uuid(1),
    total_hours: 10,
    remaining_hours: 10,
    purchased_at: "2026-10-12T00:00:00Z",
  });
  let alerts = pickRenewalAlerts(
    await withStudentBalances(db.client(), db.rows("student_packages")),
  );
  assert.equal(alerts.length, 0);
  db.insert("lesson_transactions", { student_id: uuid(1), reason: "consume", delta: -10 });
  alerts = pickRenewalAlerts(await withStudentBalances(db.client(), db.rows("student_packages")));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, `renew:${uuid(3)}:low`);
  assert.equal(alerts[0].balance, 2);
});
test("manual adjustments and refunds use the same authoritative balance", async () => {
  const db = fixture();
  db.rows("student_packages")[0].remaining_hours = 19;
  db.insert("lesson_transactions", { student_id: uuid(1), reason: "refund", delta: -1 });
  db.insert("lesson_transactions", { student_id: uuid(1), reason: "adjust", delta: -2 });
  const alerts = pickRenewalAlerts(
    await withStudentBalances(db.client(), db.rows("student_packages")),
  );
  assert.equal(alerts[0].balance, -1);
});
test("missing balance stops the reminder rather than guessing zero", async () => {
  const db = fixture();
  db.seed("students", []);
  await assert.rejects(
    withStudentBalances(db.client(), db.rows("student_packages")),
    (e) => e.code === "BALANCE_UNAVAILABLE",
  );
});
test("renewal package reads paginate beyond the old 500-row limit", async () => {
  const db = fixture();
  db.seed(
    "student_packages",
    Array.from({ length: 1201 }, (_, i) => ({
      id: uuid(i + 10),
      student_id: uuid(1),
      total_hours: 20,
      remaining_hours: 20,
    })),
  );
  const packs = await loadRenewalPackages(db.client());
  assert.equal(packs.length, 1201);
  assert.deepEqual(
    db.queries.filter((q) => q.table === "student_packages").map((q) => q.start),
    [0, 500, 1000],
  );
});
