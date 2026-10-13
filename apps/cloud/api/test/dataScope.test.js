const test = require("node:test"),
  assert = require("node:assert/strict");
const { StatefulDb, uuid } = require("./support/statefulDb.js");
const scope = require("../lib/dataScope.js");
const db = new StatefulDb();
const base = db.client();
require.cache[require.resolve("../lib/supabase.js")] = {
  exports: { getUnscopedAdmin: () => base, getAdmin: () => scope.client(base) },
};
require.cache[require.resolve("../lib/auth.js")] = {
  exports: { requireAuth: async (req) => req.context },
};
function seed() {
  db.seed("students", [
    { id: uuid(1), is_test: false },
    { id: uuid(2), is_test: true },
  ]);
  db.seed("branches", [{ id: uuid(3), is_test: true }]);
  db.seed("teachers", [
    { id: uuid(4), profile_id: uuid(5), is_test: false },
    { id: uuid(6), profile_id: uuid(7), is_test: true },
  ]);
}
const res = { setHeader() {} };
function request(context, header = "production", url = "/") {
  return { context, headers: { "x-data-scope": header }, method: "GET", url };
}
test("concurrent production and test reads remain isolated", async () => {
  seed();
  const results = await Promise.all(
    ["production", "test"].map((mode) =>
      scope.runSystem(mode, async () => {
        await new Promise((r) => setTimeout(r, mode === "test" ? 5 : 15));
        return (await scope.client(base).from("students").select("*")).data.map((r) => r.id);
      }),
    ),
  );
  assert.deepEqual(results, [[uuid(1)], [uuid(2)]]);
  assert.equal(scope.current(), null);
});
test("test administrator cannot escape by spoofing scope header", async () => {
  seed();
  const req = request({ role: "admin", isTestAccount: true, branchId: uuid(3) }, "production");
  await scope.runRequest(req, res, "students", async () => {
    assert.equal(scope.current().mode, "test");
    assert.deepEqual(
      (await scope.client(base).from("students").select("*")).data.map((r) => r.id),
      [uuid(2)],
    );
  });
});
test("normal administrator defaults to production and can select simulation", async () => {
  seed();
  for (const header of ["production", "test"])
    await scope.runRequest(request({ role: "admin" }, header), res, "students", async () =>
      assert.equal(scope.current().mode, header),
    );
});
test("teacher cannot select test data through an admin header", async () => {
  seed();
  await scope.runRequest(request({ role: "teacher" }, "test"), res, "students", async () =>
    assert.equal(scope.current().mode, "production"),
  );
});
test("test administrator cannot access backups or formal bot", async () => {
  seed();
  for (const seg of ["backups", "import-rows", "admin-bot", "admin-migrations", "renewals"])
    await assert.rejects(
      scope.runRequest(
        request({ role: "admin", isTestAccount: true, branchId: uuid(3) }),
        res,
        seg,
        () => assert.fail("handler must not run"),
      ),
      (e) => e.code === "TEST_OPERATION_FORBIDDEN",
    );
});
test("cross-scope identifiers are rejected before writes", async () => {
  seed();
  await scope.runSystem("test", async () => {
    await assert.rejects(
      scope.guardRows("lessons", { student_id: uuid(1) }),
      (e) => e.code === "DATA_SCOPE_FORBIDDEN",
    );
    await assert.rejects(
      scope.guardExisting("students", { id: uuid(1) }),
      (e) => e.code === "DATA_SCOPE_FORBIDDEN",
    );
  });
  const req = request(
    { role: "admin", isTestAccount: true, branchId: uuid(3) },
    "test",
    "/" + uuid(1),
  );
  await assert.rejects(
    scope.runRequest(req, res, "students", () => assert.fail()),
    (e) => e.code === "DATA_SCOPE_FORBIDDEN",
  );
  assert.equal(db.writes.length, 0);
});
test("patching a test student preserves their existing branch", async () => {
  await scope.runSystem("test", async () => {
    assert.deepEqual(scope.prepareRows("students", { name: "Updated" }, false), {
      name: "Updated",
      is_test: true,
    });
  });
});
test("encrypted salary registry filters classified teacher identities", async () => {
  seed();
  const values = { [uuid(5)]: { rules: [] }, [uuid(7)]: { rules: [] } };
  await scope.runSystem("production", async () =>
    assert.deepEqual(Object.keys(await scope.filterSalaryRecords(values)), [uuid(5)]),
  );
  await scope.runSystem("test", async () =>
    assert.deepEqual(Object.keys(await scope.filterSalaryRecords(values)), [uuid(7)]),
  );
});
