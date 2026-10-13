// 全量线上实测：对生产跑所有写操作（隔离 __SMOKE__ 数据），逐步断言并记录余额变化。
// 站点开发期、用户已授权。只读不到的写路径在此一次性验证。
const BASE = "https://api.17say.org";
const TAG = "__SMOKE__";
const S = Date.now().toString().slice(-6);
const DAY = 86400000;

// ---------- 工具 ----------
let token = "";
let adminId = "";
async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@17say.org", password: "Demo1234!" }),
  });
  const j = await r.json();
  token = j.data.access_token;
  adminId = j.data.user.id;
}

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, j, raw: text.slice(0, 200) };
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond });
  console.log(`  ${cond ? "OK  " : "FAIL"} ${name}${detail ? "  -- " + detail : ""}`);
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a) - Number(b)) <= eps;
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}
const at = (n) => new Date(Date.now() + n * DAY);
async function balanceOf(sid) {
  const r = await call("GET", `/students/${sid}`);
  return Number(r.j?.data?.remaining_hours ?? NaN);
}

// ============================================================
await login();
console.log("登录 OK，admin =", adminId);

// 教师（用 profile_id 建课）
const teachers = (await call("GET", "/teachers")).j.data ?? [];
const teacher = teachers[0];
const teacherPid = teacher.profile_id;
console.log("选用老师:", teacher.full_name, "profile_id =", teacherPid);

// ---------- 1. 学员 + 课时调整 ----------
console.log("\n== 1. 学员创建 / 课时调整 ==");
let sid = "";
{
  const r = await call("POST", "/students", {
    full_name: `${TAG}主${S}`,
    status: "active",
    notes: TAG,
  });
  sid = r.j?.data?.id;
  check("创建主学员", r.ok && sid, r.raw);
}

let bal = await balanceOf(sid);
console.log(`    初始余额 = ${bal}`);

// 调整 +1
{
  const r = await call("POST", `/students/${sid}/adjust-hours`, { delta: 1, reason: `${TAG}赠` });
  check("调整 +1 返回 200", r.ok, r.raw);
}
let bal2 = await balanceOf(sid);
console.log(`    +1 后余额 = ${bal2}`);
check("[口径] 调整 +1 是否计入余额", near(bal2, bal + 1), `期望 ${bal + 1}，实际 ${bal2}`);
bal = bal2;

// 调整 -0.5
{
  const r = await call("POST", `/students/${sid}/adjust-hours`, { delta: -0.5, reason: `${TAG}扣` });
  check("调整 -0.5 返回 200", r.ok, r.raw);
}
let bal3 = await balanceOf(sid);
console.log(`    -0.5 后余额 = ${bal3}`);
check("[口径] 调整 -0.5 是否计入余额", near(bal3, bal - 0.5), `期望 ${bal - 0.5}，实际 ${bal3}`);
bal = bal3;

// 校验类
{
  const r1 = await call("POST", `/students/${sid}/adjust-hours`, { delta: 1, reason: "" });
  check("缺原因被 400 拦截", r1.status === 400, `实际 ${r1.status}`);
  const r2 = await call("POST", `/students/${sid}/adjust-hours`, { delta: 0, reason: "x" });
  check("delta=0 被 400 拦截", r2.status === 400, `实际 ${r2.status}`);
}

// ---------- 2. 课时包 + 购买 ----------
console.log("\n== 2. 课时包类型 / 购买 ==");
let typeId = "";
{
  const r = await call("POST", "/packages/types", {
    name: `${TAG}包${S}`,
    hours: 10,
    price_cents: 50000,
    active: true,
  });
  typeId = r.j?.data?.id;
  check("创建课时包类型(10h)", r.ok && typeId, r.raw);
}
let spId = "";
{
  const before = await balanceOf(sid);
  const r = await call("POST", "/packages/purchase", {
    student_id: sid,
    package_type_id: typeId,
    amount_cents: 50000,
    method: "cash",
    notes: `${TAG}购包`,
    expires_at: ymd(at(180)),
  });
  spId = r.j?.data?.student_package?.id;
  check("购买课时包（创包+收款）", r.ok && spId, r.raw);
  const after = await balanceOf(sid);
  console.log(`    购包前后余额 = ${before} -> ${after}`);
  check("[口径] 购包 10h 后余额 +10", near(after, before + 10), `期望 ${before + 10}，实际 ${after}`);
  bal = after;
  const packs = (await call("GET", `/packages/student/${sid}`)).j.data ?? [];
  check("学员名下包含该包且剩余=10", packs.some((p) => p.id === spId && near(p.remaining_hours, 10)));
}

// ---------- 3. 排一节测试课并完课 ----------
console.log("\n== 3. 排课 + 完课 ==");
let lid = "";
{
  // 选一个该老师空闲的时间（避开其既有课节），否则冲突检测会拦下。
  const t = at(4);
  t.setUTCHours(2, 15, 0, 0);
  const r = await call("POST", "/schedules", {
    teacher_id: teacherPid,
    student_id: sid,
    scheduled_at: t.toISOString(),
    duration_min: 60,
  });
  lid = r.j?.data?.id;
  check("创建待上课节", r.ok && lid, r.raw);
}
{
  const r = await call("GET", `/lessons/${lid}`);
  check("课节初始为 scheduled", r.j?.data?.status === "scheduled", r.j?.data?.status);
}
let recordId = "";
{
  const before = await balanceOf(sid);
  const r = await call("POST", `/lessons/${lid}/complete`, {
    content: `${TAG}课堂内容`,
    performance: "表现良好",
    homework: "完成 P10",
    next_plan: "复习 Unit2",
    publishToParent: true,
  });
  check("完课返回 200", r.ok, r.raw);
  const after = await balanceOf(sid);
  console.log(`    完课前后余额 = ${before} -> ${after}`);
  check("[口径] 完课 1h 后余额 -1", near(after, before - 1), `期望 ${before - 1}，实际 ${after}`);
  bal = after;
}
{
  const r = await call("GET", `/lessons/${lid}`);
  const d = r.j?.data;
  check("课节变 completed", d?.status === "completed", d?.status);
  check("课节带课后记录", d?.record && d.record.content === `${TAG}课堂内容`);
  recordId = d?.record?.id;
}
{
  const r = await call("GET", `/parent/feeds?studentId=${sid}&pageSize=10`);
  const items = r.j?.data ?? [];
  check("家长动态包含该反馈", items.some((f) => (f.content || "").includes(TAG)));
}
{
  const r = await call("GET", `/reports?studentId=${sid}&published=yes&pageSize=10`);
  const items = r.j?.data ?? [];
  const hit = items.find((x) => x.record_id === recordId);
  check("报表中该记录为已发布", hit && hit.published === true);
}
{
  const r = await call("POST", `/lessons/${lid}/complete`, { content: "重复" });
  check("重复完课幂等", r.ok && r.j?.data?.alreadyCompleted === true);
  const same = await balanceOf(sid);
  check("[口径] 幂等后余额不变", near(same, bal));
}

// ---------- 4. 报表 撤回 / 重新发布 ----------
console.log("\n== 4. 报表撤回 / 重新发布 ==");
{
  const r = await call("DELETE", `/reports/${recordId}/publish`);
  check("撤回发布 200", r.ok, r.raw);
  const rep = await call("GET", `/reports?studentId=${sid}&published=no&pageSize=10`);
  const hit = (rep.j?.data ?? []).find((x) => x.record_id === recordId);
  check("撤回后报表标记为未发布", hit && hit.published === false);
  const feeds = (await call("GET", `/parent/feeds?studentId=${sid}&pageSize=10`)).j.data ?? [];
  check("撤回后家长端不再显示该反馈", !feeds.some((f) => (f.content || "").includes(TAG)));
}
{
  const r = await call("POST", `/reports/${recordId}/publish`);
  check("重新发布 200", r.ok, r.raw);
  const rep = await call("GET", `/reports?studentId=${sid}&published=yes&pageSize=10`);
  check("重新发布后恢复已发布", (rep.j?.data ?? []).some((x) => x.record_id === recordId && x.published));
  const feeds = (await call("GET", `/parent/feeds?studentId=${sid}&pageSize=10`)).j.data ?? [];
  check("重新发布后家长端恢复显示", feeds.some((f) => (f.content || "").includes(TAG)));
}

// ---------- 5. 退费 ----------
console.log("\n== 5. 退费 ==");
{
  const before = await balanceOf(sid);
  const r = await call("POST", "/packages/refund", {
    student_package_id: spId,
    hours: 2,
    amount_cents: 10000,
    method: "cash",
    notes: `${TAG}退费`,
  });
  check("退费 2h 返回 200", r.ok && near(r.j?.data?.remaining_hours, 8), r.raw);
  const after = await balanceOf(sid);
  console.log(`    退费前后余额 = ${before} -> ${after}`);
  check("[口径] 退费 2h 后余额 -2", near(after, before - 2), `期望 ${before - 2}，实际 ${after}`);
  bal = after;
}
{
  const r1 = await call("POST", "/packages/refund", {
    student_package_id: spId, hours: 999, amount_cents: 0, notes: "x",
  });
  check("超额退费被 400 拦截", r1.status === 400, `实际 ${r1.status}`);
  const r2 = await call("POST", "/packages/refund", {
    student_package_id: spId, hours: 1, amount_cents: 0, notes: "",
  });
  check("缺备注被 400 拦截", r2.status === 400, `实际 ${r2.status}`);
}

// ---------- 6. 规律课生成 ----------
console.log("\n== 6. 课程模板 + 按规律生成 ==");
let courseId = "";
const genFrom = ymd(at(3));
const genTo = ymd(at(17));
const wd = at(5).getUTCDay();
{
  const r = await call("POST", "/courses", {
    name: `${TAG}课程${S}`,
    teacher_id: teacherPid,
    student_id: sid,
    weekday: wd,
    start_time: "11:15", // =03:15 UTC，避开该老师 07:30 的既有课
    duration_min: 60,
    recurrence: "weekly",
    start_date: genFrom,
    end_date: genTo,
  });
  courseId = r.j?.data?.id;
  check("创建每周课程模板", r.ok && courseId, r.raw);
}
let genCreated = 0;
{
  const r = await call("POST", "/schedules/generate", { course_id: courseId, from: genFrom, to: genTo });
  genCreated = r.j?.data?.created ?? 0;
  check("生成课节 created>=1", r.ok && genCreated >= 1, r.raw + ` created=${genCreated}`);
}
{
  const r = await call("POST", "/schedules/generate", { course_id: courseId, from: genFrom, to: genTo });
  check("重复生成幂等(created=0)", r.ok && r.j?.data?.created === 0, `created=${r.j?.data?.created}`);
}

// ---------- 7. 数据导入 ----------
console.log("\n== 7. 数据导入 ==");
let impSid = "";
const impName = `${TAG}导入${S}`;
{
  const r = await call("POST", "/admin/import-rows", {
    entity: "students", dryrun: true, rows: [{ 姓名: impName, 状态: "在读" }],
  });
  check("dry-run 预判 created=1", r.ok && r.j?.data?.created === 1, r.raw);
}
{
  const r = await call("POST", "/admin/import-rows", {
    entity: "students", dryrun: false, rows: [{ 姓名: impName, 状态: "在读" }],
  });
  impSid = (await call("GET", `/students?search=${encodeURIComponent(impName)}&pageSize=10`)).j.data?.[0]?.id;
  check("正式导入创建学员", r.ok && r.j?.data?.created === 1 && impSid, r.raw);
}
{
  const r = await call("POST", "/admin/import-rows", {
    entity: "students", dryrun: true, rows: [{ 备注: "无姓名" }],
  });
  check("缺姓名产生错误行", r.ok && (r.j?.data?.errors?.length ?? 0) === 1);
}
// 缴费导入 + 去重
{
  const mainName = `${TAG}主${S}`;
  const body = {
    entity: "payments", dryrun: false,
    rows: [{ 学员姓名: mainName, 金额: 100, 日期: ymd(new Date()) }],
  };
  const r1 = await call("POST", "/admin/import-rows", body);
  check("缴费记录导入 created=1", r1.ok && r1.j?.data?.created === 1, r1.raw);
  const r2 = await call("POST", "/admin/import-rows", body);
  check("重复缴费导入去重 created=0", r2.ok && r2.j?.data?.created === 0);
}

// ---------- 8. 线索 ----------
console.log("\n== 8. 线索报名 / 状态变更 ==");
let leadId = "";
{
  // 公开表单：不带鉴权
  const saved = token;
  token = "";
  const r = await call("POST", "/leads", {
    parent_name: `${TAG}家长${S}`,
    parent_phone: "13800138000",
    child_age: 8,
    trial_date: ymd(at(4)),
  });
  token = saved;
  leadId = r.j?.data?.id;
  check("公开提交试听报名", r.ok && leadId, r.raw);
}
{
  const r = await call("PATCH", `/leads/${leadId}`, { status: "contacted" });
  check("线索状态改为 contacted", r.ok && r.j?.data?.status === "contacted", r.raw);
  const bad = await call("PATCH", `/leads/${leadId}`, { status: "nope" });
  check("非法状态被 400 拦截", bad.status === 400, `实际 ${bad.status}`);
}

// ---------- 9. 备份（只读） ----------
console.log("\n== 9. 备份列表 / 下载 ==");
{
  const r = await call("GET", "/backups");
  const list = r.j?.data?.items ?? r.j?.data?.backups ?? r.j?.data ?? [];
  check("备份列表可读", r.ok);
  const key = Array.isArray(list) ? list[list.length - 1] : null;
  if (key) {
    const date = typeof key === "string" ? key.replace(/^backup\//, "").replace(/\.json$/, "") : key.date;
    const d = await call("GET", `/backups/${date}/download`);
    // 下载端点直接返回备份对象（不套 {data} 信封）。
    check(
      "备份可下载且为 JSON",
      d.ok && d.j && typeof d.j === "object" && Object.keys(d.j).length > 0,
    );
  }
}

// ---------- 清理（软停用学员） ----------
console.log("\n== 清理 ==");
for (const id of [sid, impSid].filter(Boolean)) {
  const r = await call("DELETE", `/students/${id}`);
  check(`软停用学员 ${id.slice(0, 8)}`, r.ok);
}

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok);
console.log("\n================ 全量实测汇总 ================");
console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
for (const f of failed) console.log("  FAIL " + f.name);
if (failed.length) process.exitCode = 1;
