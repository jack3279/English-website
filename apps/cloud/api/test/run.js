// 找 test/*.test.js (只顶层, 不递归 integration)
// integration 测试需要真 SUPABASE env, 单独跑: pnpm test:integration
const fs = require("node:fs");
const path = require("node:path");

function find(root) {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) continue;
    if (e.name.endsWith(".test.js")) out.push(path.join(root, e.name));
  }
  return out;
}

const files = find(path.join(__dirname));
if (files.length === 0) {
  console.error("no test files found");
  process.exit(1);
}
console.log(`running ${files.length} test file(s):`);
for (const f of files) console.log("  " + path.relative(process.cwd(), f));

// 用 spawn 而不是 exec, 这样 path 含空格也能跑
// -r ./test/setup.js 预加载, 注入 mock supabase
const { spawn } = require("node:child_process");
const setupPath = path.join(__dirname, "setup.js");
const child = spawn(
  process.execPath,
  ["-r", setupPath, "--test", ...files],
  { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } },
);
child.on("exit", (code) => process.exit(code ?? 0));
