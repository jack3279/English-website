// Local-only UI verification server. No production configuration is loaded.
const http = require("node:http");
require("../setup.js");
const { generate, Bucket, uuid } = require("./statefulDb.js");
const db = generate();
require.cache[require.resolve("../../lib/supabase.js")] = {
  exports: { getAdmin: () => db.client(), createAuthClient: () => db.client() },
};
require.cache[require.resolve("../../lib/adminConfirmation.js")] = {
  exports: {
    verify: async (req, pw) => {
      if (req.context.role !== "admin" || pw !== "MOCK-password")
        throw new Error("Invalid mock confirmation");
    },
  },
};
globalThis.__CLOUDFLARE_ENV = {
  BACKUP_BUCKET: new Bucket(),
  ENCRYPTION_KEY: Buffer.alloc(32, 21).toString("base64"),
  SUPABASE_URL: "https://stateful.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "mock-only",
};
globalThis.fetch = (url, options) => db.fetch(url, options);
const { withErrorHandler } = require("../../lib/errors.js");
const handlers = Object.fromEntries(
  [
    "me",
    "teacherAvailability",
    "renewals",
    "lessons",
    "packages",
    "parent",
    "leave",
    "students",
    "schedules",
    "finance",
    "teachers",
    "courses",
    "reports",
    "operations",
    "makeups",
    "notifications",
    "institutionSettings",
  ].map((name) => [
    "/" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
    withErrorHandler(require("../../routes/" + name + ".js")),
  ]),
);
const roles = { admin: uuid(1), teacher: uuid(100), parent: uuid(300) };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
require("../../lib/secureStore.js")
  .change("private/renewals/config", {}, () => ({
    enabled: true,
    recipient: "MOCK收款人",
    qr: "data:image/png;base64," + png,
    instructions: "MOCK测试，勿真实付款",
  }))
  .then(() => {
    http
      .createServer(async (input, output) => {
        let raw = "";
        for await (const chunk of input) raw += chunk;
        const url = new URL(input.url, "http://localhost"),
          role = input.headers["x-mock-role"] || "parent",
          id = roles[role];
        let status = 200;
        const response = {
          status(n) {
            status = n;
            return this;
          },
          json(v) {
            output.writeHead(status, { "content-type": "application/json" });
            output.end(JSON.stringify(v));
          },
          setHeader() {},
        };
        const profile = db.rows("profiles").find((p) => p.id === id);
        if (url.pathname === "/__mock/summary") {
          response.json({
            data: {
              students: db.rows("students").length,
              lessons: db.rows("lessons").length,
              balance: db.balance(uuid(1000)),
              payments: db.rows("package_payments").filter((p) => p.student_id === uuid(1000)),
              records: db.rows("records").filter((r) => r.lesson_id === uuid(10012)),
              lesson: db.rows("lessons").find((r) => r.id === uuid(10012)),
            },
          });
          return;
        }
        if (url.pathname === "/me") {
          response.json({ data: profile });
          return;
        }
        if (url.pathname === "/me/renewal") {
          response.json({ data: { items: [] } });
          return;
        }
        if (["/messages/unread-count", "/notifications/unread-count"].includes(url.pathname)) {
          response.json({ data: 0 });
          return;
        }
        const prefix = "/" + url.pathname.split("/")[1],
          handler = handlers[prefix];
        if (!handler) {
          response.status(404).json({ error: "Mock server has no handler " + url.pathname });
          return;
        }
        await handler(
          {
            url: url.pathname.slice(prefix.length) + url.search || "/",
            method: input.method,
            body: raw ? JSON.parse(raw) : {},
            headers: { authorization: "Bearer mock-token" },
            __testUser: { ...profile },
            context: { userId: id, role },
            reqId: "browser-stateful",
          },
          response,
        );
      })
      .listen(3012, "127.0.0.1", () =>
        console.log("Stateful isolated QA API: http://127.0.0.1:3012 (mock data only)"),
      );
  });
