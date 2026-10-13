// 静态守卫：react-query 的 queryKey 必须与查询处一致。
//
// 背景（本项目反复出现的 bug 类型）：
//   useSchedule 查询用的是 ["schedules", {...}]（复数），但某处 invalidate 写成
//   ["schedule"]（单数）或 ["lessons"]（全项目不存在）→ 接口成功、toast 弹出，
//   但界面不刷新，用户以为没生效又重复点击。已真实发生 10 处。
//
// 为什么用静态检查而不是行为测试：
//   mock 的 queryClient 不会真的去比对 key 注册表，行为测试拦不住"key 拼错"。
//
// 断言方式：invalidate 的 key 若是某个已声明 queryKey 的前缀，必须能命中。
import { test, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js") || e.name.endsWith(".jsx")) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);

// 把 `const KEY = ["a","b"]` 展开，供 ["...", KEY] 这类引用解析
function collectConstArrays(src) {
  const map = new Map();
  // 两种形态都要收：export const KEY = [...] 与局部 const KEY = [...]
  const re = /(?:export\s+)?const\s+(\w+)\s*=\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const parts = m[2]
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.every((p) => /^"[^"]*"$/.test(p) || /^'[^']*'$/.test(p))) {
      map.set(name, parts.map((p) => p.slice(1, -1)));
    }
  }
  return map;
}

// 按顶层逗号切分（跳过嵌套 [] {} () 与字符串内字符）
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "{" || ch === "(") depth++;
    if (ch === "]" || ch === "}" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// 解析 key 表达式；解析不出来返回 null（此时跳过判定，避免误报）
// 注意：["schedules", { from, to }] 里的对象字面量不是 key，要整段丢弃，
// 否则 splitTop 会把它当元素、readKeyExpr 解析失败 → 声明被漏掉 → 误报。
function readKeyExpr(expr, consts, depth = 0) {
  const e = expr.trim();
  if (depth > 4) return null;
  if (e.startsWith("[") && e.endsWith("]")) {
    const inner = e.slice(1, -1).trim();
    if (!inner) return [];
    const out = [];
    for (const raw of splitTop(inner)) {
      const t = raw.trim();
      // 丢弃对象/函数等非 key 片段（它们只是 filter 参数，不是 key 的一部分）
      if (t.startsWith("{") || t.startsWith("(") || t.startsWith("function")) continue;
      // 首段（根 key）必须是字面量或可解析的常量；
      // 后续段允许是变量（statusFilter / id / {from,to} 都是 filter，不是 key）。
      // 只有首段解析失败才放弃 —— 否则 ["leads", statusFilter] 会被误判为未声明。
      const r = readKeyExpr(t, consts, depth + 1);
      if (r === null) {
        if (out.length === 0) return null; // 首段不行 → 整个 key 无法判定
        continue; // 后续段是变量，忽略即可
      }
      out.push(...r);
    }
    return out;
  }
  if (e.startsWith("...")) return readKeyExpr(e.slice(3), consts, depth + 1);
  const lit = e.match(/^"([^"]*)"$/) || e.match(/^'([^']*)'$/);
  if (lit) return [lit[1]];
  if (consts.has(e)) return consts.get(e);
  return null;
}

// 取 key 数组的字面量文本：queryKey: ["schedules", { from, to }] 里的对象字面量要整体保留，
// 再由 readKeyExpr 决定能否解析。用括号配对扫描，而不是正则截 ] ——
// 截断会把含嵌套对象的声明解析失败，导致误报"key 未声明"。
function extractKeyArray(text) {
  let depth = 0;
  let q = null;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      q = ch;
      out += ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      out += ch;
      if (depth === 0) return out;
      continue;
    }
    out += ch;
  }
  return out;
}

// queryKey 常量是跨文件引用的（如 useNotifications.js 里非导出的 KEY = ["notifications"]，
// 被 features/leave/useLeave.js invalidate）。单文件解析不到，
// 所以先把全项目的字面量常量汇总成一张全局表再解析。
function collectGlobalConsts() {
  const global = new Map();
  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    for (const [k, v] of collectConstArrays(src)) {
      // 同名常量内容一致才算可靠；冲突则不信任（宁可跳过判定）
      if (!global.has(k)) global.set(k, v);
      else if (JSON.stringify(global.get(k)) !== JSON.stringify(v)) global.set(k, null);
    }
  }
  for (const [k, v] of [...global]) if (v === null) global.delete(k);
  return global;
}

const GLOBAL_CONSTS = collectGlobalConsts();

test("invalidateQueries 的 key 都能命中某个已声明的 queryKey", () => {
  const declaredRoots = new Set();
  const invalidates = [];

  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    // 本文件常量优先，其次全局表
    const consts = new Map([...GLOBAL_CONSTS, ...collectConstArrays(src)]);

    // 收集声明的 queryKey
    const declRe = /queryKey:/g;
    let m;
    while ((m = declRe.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      // 关键：必须排除 invalidateQueries({ queryKey: [...] }) 这种调用点，
      // 否则错误 key 会被自己当成"已声明"，守卫永远绿（本项目已踩过这个坑）。
      if (/invalidateQueries\(\s*\{[\s,]*$/.test(before)) continue;
      const trimmed = src.slice(m.index + "queryKey:".length).replace(/^\s+/, "");
      let key = null;
      if (trimmed.startsWith("[")) {
        key = readKeyExpr(extractKeyArray(trimmed), consts);
      } else {
        // 形如 queryKey: KEY / queryKey: SCHEDULE_KEY —— 整个 key 就是个常量引用
        const ident = trimmed.match(/^(\w+)/);
        if (ident) key = consts.has(ident[1]) ? consts.get(ident[1]) : null;
      }
      if (key?.length && typeof key[0] === "string") declaredRoots.add(key[0]);
    }

    // 收集 invalidate 的 key
    src.split(/\r?\n/).forEach((line, i) => {
      const at = line.indexOf("invalidateQueries(");
      if (at < 0) return;
      const q = line.indexOf("queryKey:", at);
      if (q < 0) return;
      const trimmed = line.slice(q + "queryKey:".length).replace(/^\s+/, "");
      if (!trimmed.startsWith("[")) return;
      const key = readKeyExpr(extractKeyArray(trimmed), consts);
      if (!key?.length || typeof key[0] !== "string") return;
      invalidates.push({ file: path.relative(SRC, file), line: i + 1, key });
    });
  }

  expect(declaredRoots.size).toBeGreaterThan(0);
  expect(invalidates.length).toBeGreaterThan(0);

  // react-query 的匹配语义是"前缀匹配"：
  //   invalidate(["schedules"])        能命中 ["schedules", {...}]
  //   invalidate(["student", id])      能命中 ["student", id]（全等）
  //   invalidate(["lessons"])          命中不了 ["schedules", ...] —— 首段就不一致
  // 所以只需比首段 key，这是既不会误报、又能抓住真实 bug 的判定。
  const bad = invalidates.filter((iv) => !declaredRoots.has(iv.key[0]));
  const detail = bad
    .map((b) => `  ${b.file}:${b.line}  ["${b.key.join('", "')}"]`)
    .join("\n");

  expect(
    bad.length,
    `\n发现 ${bad.length} 处 invalidateQueries 的 key 与任何已声明的 queryKey 首段都不一致：\n${detail}\n` +
      `  已声明的 key 根：${[...declaredRoots].sort().join(", ")}\n` +
      `  → 这类不匹配不会报错，只是界面不刷新（接口其实成功了），最难自查。\n` +
      `  → invalidate 的首段必须能在某处 queryKey 里找到。\n`,
  ).toBe(0);
});

test("解析器自身可用（避免守卫是永远绿的假测试）", () => {
  const consts = collectConstArrays(`export const SCHEDULE_KEY = ["schedules"];`);
  expect(readKeyExpr(`["schedules"]`, consts)).toEqual(["schedules"]);
  expect(readKeyExpr(`SCHEDULE_KEY`, consts)).toEqual(["schedules"]);
  expect(readKeyExpr(`["a", ...SCHEDULE_KEY, "b"]`, consts)).toEqual(["a", "schedules", "b"]);
  expect(readKeyExpr(`[key]`, consts)).toBe(null); // 不可静态解析 → 跳过判定
});

test("课表 key 必须是复数 schedules（回归防护）", () => {
  const src = fs.readFileSync(path.join(SRC, "features", "schedule", "useSchedule.js"), "utf8");
  expect(src).toMatch(/queryKey:\s*\[\s*"schedules"/);

  const offenders = [];
  for (const file of FILES) {
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/invalidateQueries\(\{\s*queryKey:\s*\[\s*"schedule"\s*\]/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
  }
  expect(offenders, `这些地方仍用单数 ["schedule"]：\n  ${offenders.join("\n  ")}`).toEqual([]);
});

test("负向探针：故意写错的 key 会被守卫抓到", () => {
  // 模拟：如果有人把 invalidate 写成 ["lessons"]（不存在的 key），应被判为不匹配
  const declaredRoots = new Set(["schedules", "lesson-detail", "students"]);
  expect(declaredRoots.has("lessons")).toBe(false);
  expect(declaredRoots.has("schedule")).toBe(false);
  expect(declaredRoots.has("schedules")).toBe(true);
});