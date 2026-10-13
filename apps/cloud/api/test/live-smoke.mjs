// 线上只读冒烟测试: 用三个演示角色登录生产 API, 遍历所有主要 GET(读)接口。
// 用法: node test/live-smoke.mjs [BASE]
//   BASE 默认 https://api.17say.org
// 只发 GET 请求, 不写数据, 可安全对生产跑。
const BASE = process.argv[2] || "https://api.17say.org";

const ROLES = [
  { name: "admin", email: "admin@17say.org", password: "Demo1234!" },
  { name: "teacher", email: "emma@17say.org", password: "Demo1234!" },
  { name: "parent", email: "lilyparent@17say.org", password: "Demo1234!" },
];

function iso(d) {
  return d.toISOString();
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const weekAgo = new Date(now.getTime() - 7 * 864e5);
const weekLater = new Date(now.getTime() + 7 * 864e5);
const q = {
  today: iso(now),
  weekAgo: iso(weekAgo),
  weekLater: iso(weekLater),
  monthStart: iso(monthStart),
  // 财务/报表接口要求 YYYY-MM-DD（不是 ISO 时间戳）
  todayYmd: ymd(now),
  monthStartYmd: ymd(monthStart),
};

// 每个角色要测的只读路径(模板里可注入日期)。
const PLANS = {
  admin: [
    "/institution-settings",
    "/accounts",
    "/families/parents",
    "/me",
    "/me/sessions",
    "/me/renewal",
    "/branches",
    "/operations",
    "/alerts",
    "/alerts/low-balance",
    "/backups",
    "/audit",
    "/teachers",
    "/teachers/candidates",
    "/students?pageSize=100",
    "/students?page=1&pageSize=20",
    "/courses",
    "/packages/types",
    "/schedules?from=${weekAgo}&to=${weekLater}",
    "/finance/summary",
    "/finance/revenue?from=${monthStartYmd}&to=${todayYmd}&limit=500",
    "/finance/payroll?from=${monthStart}",
    "/finance/exceptions",
    "/finance/renewals",
    "/reports?from=${monthStartYmd}&to=${todayYmd}",
    "/reports/lesson-stats?from=${monthStartYmd}&to=${todayYmd}",
    "/reports/teacher-attendance?from=${monthStartYmd}&to=${todayYmd}",
    "/notifications?limit=200",
    "/messages/teammates",
    "/messages/unread-count",
    "/leave?status=pending&limit=50",
    "/leave?limit=50",
    "/makeups?limit=50",
    "/announcements",
    "/materials?limit=50",
  ],
  teacher: [
    "/institution-settings",
    "/me",
    "/schedules?from=${today}&to=${today}",
    "/finance/my-payroll",
    "/leave?limit=50",
    "/makeups?limit=50",
    "/notifications?limit=50",
    "/messages/teammates",
    "/messages/unread-count",
    "/announcements",
  ],
  parent: [
    "/institution-settings",
    "/me",
    "/me/renewal",
    "/students?pageSize=50",
    "/parent/lessons/upcoming",
    "/parent/feeds?studentId=${parentStudentId}&pageSize=10",
    "/notifications?limit=50",
  ],
};

function fill(tpl) {
  return tpl.replace(/\$\{(\w+)\}/g, (_, k) => encodeURIComponent(q[k]));
}

async function login(role) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://17say.org" },
    body: JSON.stringify({ email: role.email, password: role.password }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`login non-json (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data?.data?.access_token) {
    throw new Error(`login failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return data.data;
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, origin: "https://17say.org" },
  });
  const text = await res.text();
  let parsed = null;
  let parseErr = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (e) {
    parseErr = e.message;
  }
  return { status: res.status, ok: res.ok, text, parsed, parseErr };
}

const results = [];
for (const role of ROLES) {
  let session;
  try {
    session = await login(role);
  } catch (e) {
    console.log(`\n[${role.name}] 登录失败: ${e.message}`);
    results.push({ role: role.name, path: "LOGIN", ok: false, detail: e.message });
    continue;
  }
  // 家长动态接口必带 studentId：先拿家长名下孩子补上。
  if (role.name === "parent") {
    const sr = await get(session.access_token, "/students?pageSize=50");
    q.parentStudentId = sr.parsed?.data?.[0]?.id ?? "";
  }
  console.log(`\n===== [${role.name}] ${role.email} =====`);
  for (const tpl of PLANS[role.name]) {
    const path = fill(tpl);
    let r;
    try {
      r = await get(session.access_token, path);
    } catch (e) {
      console.log(`  NETFAIL ${path}  ${e.message}`);
      results.push({ role: role.name, path, ok: false, detail: `NET ${e.message}` });
      continue;
    }
    const apiErr = r.parsed?.error || r.parsed?.code;
    const ok = r.ok && !r.parseErr && !apiErr;
    // 404/500/403/400 以及非 JSON 都算问题
    const mark = ok ? "OK  " : "FAIL";
    let detail = "";
    if (!ok) {
      if (r.parseErr) detail = `non-json: ${r.text.slice(0, 80)}`;
      else detail = apiErr ? `${r.parsed.error || ""} [${r.parsed.code}]` : `HTTP ${r.status}`;
    } else {
      // 简要显示数据形态
      const d = r.parsed?.data;
      detail = Array.isArray(d) ? `array[${d.length}]` : d && typeof d === "object" ? "object" : String(d);
    }
    console.log(`  ${mark} ${r.status} ${path}${ok ? "  -> " + detail : "  -> " + detail}`);
    results.push({ role: role.name, path, ok, status: r.status, detail });
  }
}

const failed = results.filter((r) => !r.ok);
console.log("\n========== 汇总 ==========");
console.log(`总检查 ${results.length}  通过 ${results.length - failed.length}  失败 ${failed.length}`);
if (failed.length) {
  console.log("\n失败项:");
  for (const f of failed) console.log(`  [${f.role}] ${f.path}  -- ${f.detail}`);
  process.exitCode = 1;
}
