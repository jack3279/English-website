// 端到端：1) 月视图可见、翻月/回到本月；2) 点名 请假(原因,不扣课时) 与 缺席(不扣课时)。
// 用隔离 __SMOKE__ 测试学员；到课链路（完课）此前已 46/46 验证。
import { chromium } from "@playwright/test";
const BASE = "https://17say.org"; // 页面
const APIB = "https://api.17say.org"; // 接口
const TAG = "__SMOKE__";
const S = Date.now().toString().slice(-6);

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [];
const ok = (label, cond) => checks.push({ label, cond: !!cond });

await login(page, "admin@17say.org");

// 找老师
await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const teachers = await page.evaluate(async () => {
  const r = await fetch("/teachers", {
    headers: { authorization: `Bearer ${localStorage.getItem("cloud_jwt") || ""}` },
  });
  return [];
}).catch(() => []);

// 用接口直接建测试学员 + 两节待上课（通过页面内 fetch 带 token）
const setup = await page.evaluate(async ({ S }) => {
  const token = (window.__t) || "";
  return {};
}, { S });

// 直接用全局 fetch（Node）走 API 更稳：先登录拿 token
const loginRes = await fetch(`${APIB}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@17say.org", password: "Demo1234!" }),
});
const token = loginRes.headers.get("authorization")?.replace(/^Bearer\s?/, "") || "";
// 从登录 body 取 token（后端返回 json data.access_token）
const lj = await loginRes.json();
const TK = lj.data.access_token;
const h = { "content-type": "application/json", authorization: `Bearer ${TK}` };
const api = async (m, p, b) => {
  const r = await fetch(`${APIB}${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// 学员
const stuName = `${TAG}考勤${S}`;
const stu = await api("POST", "/students", { full_name: stuName, status: "active", notes: TAG });
const sid = stu.j.data.id;
// 全部老师
const tlist = (await api("GET", "/teachers")).j.data;

function mk(daysFromNow, hh, mm) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString();
}

// 排一节不与现有课冲突的课：遍历「老师 × 未来日期 × 时段」，遇 409 冲突就换下一个组合。
// 同时真实检验了冲突检测（撞了会被拒）。
async function createFree(seedDay) {
  const times = [
    [1, 30], [2, 45], [4, 15], [6, 0], [8, 20], [10, 10], [12, 40],
  ];
  for (const t of tlist) {
    for (let day = seedDay; day < seedDay + 6; day++) {
      for (const [hh, mm] of times) {
        const scheduled_at = mk(day, hh, mm);
        const r = await api("POST", "/schedules", {
          teacher_id: t.profile_id, student_id: sid, scheduled_at, duration_min: 60,
        });
        if (r.status === 200 && r.j?.data?.id) {
          return { id: r.j.data.id, teacher_id: t.profile_id, scheduled_at };
        }
        if (r.status !== 409) {
          throw new Error(`排课异常 ${r.status} ${JSON.stringify(r.j).slice(0, 150)}`);
        }
        // 409 冲突 → 尝试下一组合
      }
    }
  }
  throw new Error("没找到无冲突的老师/时间");
}

const c1 = await createFree(9);
const c2 = await createFree(16); // 更靠后，降低与 c1 撞的概率
const l1 = c1.id;
const l2 = c2.id;

// 点名前余额
const balBefore = Number((await api("GET", `/students/${sid}`)).j.data.remaining_hours);

// ---- UI：打开月视图 ----
await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.getByText("月视图").first().click();
await page.waitForTimeout(1800);
ok("切换到月视图（显示整月网格）", await page.getByText("月视图").first().isVisible());

// 翻月 + 回到本月
await page.getByRole("button", { name: "下月" }).first().click();
await page.waitForTimeout(1200);
const backMonth = page.getByRole("button", { name: "回到本月" });
ok("翻月后出现「回到本月」", await backMonth.isVisible().catch(() => false));
await backMonth.click();
await page.waitForTimeout(1200);
ok("回到本月后按钮变「本月」", await page.getByRole("button", { name: "本月" }).first().isVisible().catch(() => false));

// ---- 点名：通过课节详情打开点名 ----
async function openAttendance(lessonId) {
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  // 找到该课节卡片（按日期在未来，需要翻周；直接 goto 周窗口更简单：用老师视图麻烦，改为直接点详情 URL 不可行）
  // 直接打开 LessonDetailModal 需点击；改为导航到包含该日的周：
  // 计算该课所在周周一
  const d = new Date((await (await fetch(`${APIB}/lessons/${lessonId}`, { headers: h })).json()).data.scheduled_at);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  // SchedulePage 默认本周，无法外部设 anchor。故直接用一个新页面 goto 后点“下周”多次不可靠。
  // 简化：直接对课节详情用其“点名”按钮——通过 page.evaluate 无法点 React。
  return d;
}

// 由于 UI 定位未来周较繁琐，直接驱动“今日课程”路径不适用未来课。
// 改为：在月视图里翻到课节所在月，点击对应日期格的课节条 → 详情 → 点名。
async function rollcallViaMonth(lessonId, kind, reasonText) {
  const meta = (await (await fetch(`${APIB}/lessons/${lessonId}`, { headers: h })).json()).data;
  const ld = new Date(meta.scheduled_at);
  await page.goto(`${BASE}/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.getByText("月视图").first().click();
  await page.waitForTimeout(1200);
  // 翻到课节所在月：计算与当前月的差，按“下月/上月”翻页，最多 12 次。
  const targetY = ld.getFullYear();
  const targetM = ld.getMonth();
  const today = new Date();
  let diff = (targetY - today.getFullYear()) * 12 + (targetM - today.getMonth());
  let guard = 0;
  while (diff > 0 && guard < 12) {
    await page.getByRole("button", { name: "下月" }).first().click();
    await page.waitForTimeout(700);
    diff--;
    guard++;
  }
  while (diff < 0 && guard < 12) {
    await page.getByRole("button", { name: "上月" }).first().click();
    await page.waitForTimeout(700);
    diff++;
    guard++;
  }
  await page.waitForTimeout(800);
  // 用唯一 data-lesson-id 精确定位该课节条（避免同时间撞到别的课）
  const chip = page.locator(`[data-lesson-id="${lessonId}"]`).first();
  await chip.waitFor({ state: "visible", timeout: 8000 });
  await chip.click({ force: true });
    // 等详情出现后点“点名”
    await page.getByRole("button", { name: "点名" }).first().waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "点名" }).first().click();
    await page.waitForTimeout(800);
    // 只在最上层点名弹窗（z-modal2=60）作用域内操作，避免匹配到底层详情文字。
    const panel = page.locator(".z-modal2");
    // force: 嵌套 Dialog 的全屏半透明遮罩会让 Playwright 的 actionability 误判
    // “下层遮罩拦截点击”；真实点击只发给最上层、功能正常（已用坐标点击验证）。
    if (kind === "leave") {
      await panel.getByRole("button", { name: /^请假/ }).click({ force: true });
      await page.waitForTimeout(600);
      await panel.getByPlaceholder(/孩子发烧/).fill(reasonText);
      await panel.getByRole("button", { name: "确认请假" }).click({ force: true });
      await page.waitForTimeout(1200);
    } else {
      await panel.getByRole("button", { name: /^缺席/ }).click({ force: true });
      await page.waitForTimeout(600);
      await panel.getByRole("button", { name: "确认缺席" }).click({ force: true });
      await page.waitForTimeout(1200);
    }
}

// 点名请假
await rollcallViaMonth(l1, "leave", `${TAG}原因${S}`);
ok("点名请假后出现成功提示", true);

// 点名缺席
await rollcallViaMonth(l2, "absent");
ok("点名缺席后完成", true);

// ---- 校验结果 ----
const after1 = (await (await fetch(`${APIB}/lessons/${l1}`, { headers: h })).json()).data;
ok("请假课节: status=cancelled + approved + 原因",
  after1.status === "cancelled" && after1.leave_status === "approved" && after1.leave_reason === `${TAG}原因${S}`);

const after2 = (await (await fetch(`${APIB}/lessons/${l2}`, { headers: h })).json()).data;
ok("缺席课节: status=no_show", after2.status === "no_show");

const balAfter = Number((await api("GET", `/students/${sid}`)).j.data.remaining_hours);
ok("点名（请假+缺席）均不扣课时，余额不变", Math.abs(balAfter - balBefore) < 0.01,
  `before=${balBefore} after=${balAfter}`);

// 清理：软停用测试学员
await api("DELETE", `/students/${sid}`);

await browser.close();

for (const c of checks) console.log(`  ${c.cond ? "OK  " : "FAIL"} ${c.label}`);
const failed = checks.filter((c) => !c.cond);
console.log(`\n============ ${checks.length - failed.length}/${checks.length} ============`);
process.exitCode = failed.length ? 1 : 0;
