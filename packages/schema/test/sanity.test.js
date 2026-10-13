const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/index.js");

test("schema 包导出非空对象", () => {
  assert.equal(typeof schema, "object");
  assert.ok(schema !== null);
});
