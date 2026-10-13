const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../src/index.js");

test("domain 包导出非空对象", () => {
  assert.equal(typeof domain, "object");
  assert.ok(domain !== null);
});
