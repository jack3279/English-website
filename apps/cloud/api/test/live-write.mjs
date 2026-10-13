// 线上写操作测试: 对生产跑核心资源的 增->改->删, 每步校验, 结束后清理。
// 站点处于开发期且用户授权直接测试; 数据统一用 __SMOKE__ 前缀, 便于识别/兜底清理。
// 用法: node test/live-write.mjs [BASE]
const BASE = process.argv[2] || "https://api.17say.org";
const TAG = "__SMOKE__";
const stamp = Date.now().toString().slice(-6);

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://17say.org" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j?.data?.access_token) throw new Error("login failed");
  return j.data;
}

function makeClient(token) {
  return async function call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: "https://17say.org",
        authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let j = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, ok: res.ok, j, raw: text.slice(0, 200) };
  };
}

const steps = [];
function check(name, cond, detail = "") {
  steps.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? "OK  " : "FAIL"} ${name}${detail ? "  -- " + detail : ""}`);
}

async function run() {
  const session = await login("admin@17say.org", "Demo1234!");
  const call = makeClient(session.access_token);
  const meId = (await call("GET", "/me")).j.data.id;

  // ---------- 学员 CRUD ----------
  console.log("\n== 学员 students ==");
  const sName = `${TAG}学生${stamp}`;
  let studentId = null;
  try {
    const c = await call("POST", "/students", { full_name: sName, status: "active" });
    check("创建学员 200", c.ok && c.j?.data?.id, c.status === 200 ? "" : c.raw);
    studentId = c.j?.data?.id;
    if (studentId) {
      const r = await call("GET", `/students?search=${encodeURIComponent(sName)}&pageSize=10`);
      const found = (r.j?.data || []).some((x) => x.id === studentId);
      check("列表能查到新学员", found);
      const u = await call("PATCH", `/students/${studentId}`, { notes: "冒烟备注" });
      check("修改学员 200", u.ok && u.j?.data?.notes === "冒烟备注", u.ok ? "" : u.raw);
    }
  } finally {
    if (studentId) {
      const d = await call("DELETE", `/students/${studentId}`);
      check("删除学员(停用) 200", d.ok, d.ok ? "" : d.raw);
    }
  }

  // ---------- 课时包类型 CRUD ----------
  console.log("\n== 课时包类型 package_types ==");
  let pkgId = null;
  const pName = `${TAG}套餐${stamp}`;
  try {
    const c = await call("POST", "/packages/types", { name: pName, hours: 1.5, price_cents: 1000 });
    check("创建套餐 200", c.ok && c.j?.data?.id, c.ok ? "" : c.raw);
    pkgId = c.j?.data?.id;
    if (pkgId) {
      const u = await call("PATCH", `/packages/types/${pkgId}`, { price_cents: 2000 });
      check("修改套餐 200", u.ok && u.j?.data?.price_cents === 2000, u.ok ? "" : u.raw);
    }
  } finally {
    if (pkgId) {
      const d = await call("DELETE", `/packages/types/${pkgId}`);
      check("删除套餐 200", d.ok, d.ok ? "" : d.raw);
    }
  }

  // ---------- 公告 CRUD ----------
  console.log("\n== 公告 announcements ==");
  let annId = null;
  const aTitle = `${TAG}公告${stamp}`;
  try {
    const c = await call("POST", "/announcements", { title: aTitle, body: "冒烟正文", audience: "teacher" });
    check("创建公告 200", c.ok && c.j?.data?.id || c.j?.data?.title === aTitle, c.ok ? "" : c.raw);
    annId = c.j?.data?.id;
    if (annId) {
      const u = await call("PATCH", `/announcements/${annId}`, { title: aTitle + "改" });
      check("修改公告 200", u.ok, u.ok ? "" : u.raw);
    }
  } finally {
    if (annId) {
      const d = await call("DELETE", `/announcements/${annId}`);
      check("删除公告 200", d.ok, d.ok ? "" : d.raw);
    }
  }

  // ---------- 站内信: 发给自己 ----------
  console.log("\n== 站内信 messages ==");
  const send = await call("POST", "/messages", { to_user: meId, subject: `${TAG}消息`, body: "冒烟内容" });
  check("发送站内信 200", send.ok, send.ok ? "" : send.raw);
  const mates = await call("GET", "/messages/teammates");
  check("拉取会话列表 200", mates.ok && Array.isArray(mates.j?.data), mates.ok ? "" : mates.raw);

  // ---------- 通知: 全部已读 (幂等, 安全) ----------
  console.log("\n== 通知 notifications ==");
  const rd = await call("POST", "/notifications/read", {});
  check("全部通知标记已读 200", rd.ok, rd.ok ? "" : rd.raw);

  // ---------- 汇总 ----------
  const failed = steps.filter((s) => !s.ok);
  console.log("\n========== 写操作汇总 ==========");
  console.log(`步骤 ${steps.length}  通过 ${steps.length - failed.length}  失败 ${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.name} -- ${f.detail}`);
  if (failed.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
