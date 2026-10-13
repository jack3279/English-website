// 站内通知的「尽力而为」写入通道。
//
// 约定：通知失败**绝不能**影响主流程（报名、发消息、消课都必须照常成功），
// 但一定要 warn 留痕 —— 否则「通知没发出去」是完全静默的：
// 页面上的通知铃铛只是安静地不响，没人知道是业务没触发还是写库失败了。
//
// 用 restInsert（raw PostgREST）而不是 supabase-js，理由同 lib/rest.js。
const { restInsert } = require("./rest.js");
const { getAdmin } = require("./supabase.js");
const { warn } = require("./log.js");

// WeCom 推送通道：与站内通知并行, 一处失败不影响另一处。
// 引入是动态 require —— src/wecom.js 依赖较多, 启动时不必立即加载,
// 仅在事件触发的实时推送路径上才用 (cron 走 src/scheduled.js 直接拿 wecom)。
function wecomMod() {
  try {
    return require("../src/wecom.js");
  } catch (_) {
    return null;
  }
}

// rows: 一条或多条 { type, title, body, target_user?, target_role?, student_id?, link? }
// 可见性规则（见 routes/notifications.js 的 visibleTo）：
//   target_user 定向某人 > target_role 广播给某角色 > 都不给则全员可见
// 所以「通知所有管理员」只需插一条 target_role='admin'，不必一人一条（省子请求）。
async function push(rows, ctx = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return 0;
  try {
    await restInsert("notifications", list, "return=minimal");
    return list.length;
  } catch (e) {
    warn("notify_failed", { ...ctx, count: list.length, err: e && e.message });
    return 0;
  }
}

// 某学员的家长 profile_id 列表（站内通知收件人）。
// 一个学员可能绑了多位家长，也可能一个都没绑 —— 都不要报错。
async function parentProfileIds(studentId) {
  if (!studentId) return [];
  const { data } = await getAdmin()
    .from("parent_student_links")
    .select("parents(profile_id)")
    .eq("student_id", studentId);
  return [...new Set((data ?? []).map((l) => l.parents?.profile_id).filter(Boolean))];
}

// 学员身上的「企业微信 external_user_id」(v4 迁移后改挂在 students 上)。
// 一个学员对应一个微信联系人, 是简化模型; 如果将来支持一学员多家长, 这里
// 要改成多值字段。返回单值或 null。
async function parentExternalId(studentId) {
  if (!studentId) return null;
  const { data } = await getAdmin()
    .from("students")
    .select("wecom_external_user_id")
    .eq("id", studentId)
    .maybeSingle();
  return data?.wecom_external_user_id || null;
}

// 给某学员的家长们推一条通知。build 是「除 target_user/student_id 之外的字段」。
// 「消课写了反馈」「课被改期」「课被取消」都要通知家长，写三份必然长歪，统一到这里。
async function pushToParents(studentId, build, ctx = {}) {
  try {
    const ids = await parentProfileIds(studentId);
    if (!ids.length) return 0; // 没绑家长 = 没地方发, 不是错误
    const rows = ids.map((uid) => ({ target_user: uid, student_id: studentId, ...build }));
    return await push(rows, ctx);
  } catch (e) {
    warn("notify_parents_failed", { ...ctx, studentId, err: e && e.message });
    return 0;
  }
}

// 同时走「站内」+「企业微信」两通道。任一通道失败都不影响另一通道, 也不影响调用方。
//   buildStation: { type, title, body, link? }        -> 站内 notifications
//   buildWecom:   (parentExternalId) => string         -> WeCom 文本 (e.g. classReportJobs payload)
//
// 典型用法:
//   await notify.pushBoth(studentId,
//     { type:'class_report', title:'...', body:'...', link:'/parent' },
//     (extId) => wecom.classReportJobs({ parentWecomIds:[extId], payload:{...} }),
//   );
async function pushBoth(studentId, buildStation, buildWecom, ctx = {}) {
  // 站内
  await pushToParents(studentId, buildStation, { ...ctx, channel: "station" });
  // WeCom
  const wecom = wecomMod();
  if (!wecom || !wecom.extEnabled || !wecom.extEnabled()) return { sent: 0, skipped: 1 };
  const extId = await parentExternalId(studentId);
  if (!extId) return { sent: 0, skipped: 1 };
  try {
    const jobs = buildWecom(extId);
    return await wecom.runBatch(jobs);
  } catch (e) {
    warn("notify_wecom_failed", { ...ctx, studentId, err: e && e.message });
    return { sent: 0, failed: 1 };
  }
}

module.exports = { push, parentProfileIds, parentExternalId, pushToParents, pushBoth };
