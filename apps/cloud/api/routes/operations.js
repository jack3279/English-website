// 运营任务中心 —— "今天到底有哪些事等我处理"。
//
// 设计取舍: 这些待办原本散落在 6 个页面里(请假/补课/线索/排课/财务),
// 教务每天要挨个点开才知道有没有活。这里**在服务端一次聚合**成一张清单:
//   · 前端只发 1 个请求, 而不是 7 个(Workers Free 每请求 50 子请求, 前端并发也浪费);
//   · 每类待办的判定口径复用各自的权威实现(续费用 pickRenewalAlerts),
//     避免出现"财务页说要续费、运营中心说不用"的两套标准。
//
// 只读接口, 不做写操作 —— 点进去跳原页面处理, 避免又长出一套审批逻辑。

const { withErrorHandler } = require("../lib/errors.js");
const { ok } = require("../lib/http.js");
const { requireAuth, requireRole } = require("../lib/auth.js");
const { getAdmin } = require("../lib/supabase.js");
const { visibleStudentIds } = require("../lib/scoping.js");
const { loadRenewalPackages, withStudentBalances } = require("../lib/renewalBalances.js");

const DAY = 24 * 3600 * 1000;

// 超时未完课 / 完课没写反馈 只看最近这段时间：
// 更久之前的是历史脏数据，天天挂在待办上只会让人麻木。
const STALE_WINDOW_DAYS = 7;

function ago(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

async function studentNames(admin, ids) {
  const uniq = [...new Set((ids ?? []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await admin.from("students").select("id, full_name").in("id", uniq);
  return new Map((data ?? []).map((r) => [r.id, r.full_name ?? "?"]));
}

function group({ key, kind, severity, title, hint, link, items }) {
  return { key, kind, severity, title, hint, link, count: items.length, items: items.slice(0, 8) };
}

module.exports = async function handler(req, res) {
  await withErrorHandler(async () => {
    await requireAuth(req, res);
    requireRole(req, res, "admin", "teacher");

    const admin = getAdmin();
    const scope = await visibleStudentIds(req); // null = admin 不限
    const scoped = (ids) => (scope ? ids.filter((id) => scope.includes(id)) : ids);

    const isAdmin = req.context.role === "admin";
    const [leaveRes, makeupRes, overdueRes, completedRes, leadRes] = await Promise.all([
      admin
        .from("leave_requests")
        .select("id, student_id, reason, created_at, lesson_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50),
      admin
        .from("makeups")
        .select("id, student_id, created_at, original_lesson_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50),
      // 过了上课时间却还是 scheduled —— 老师忘了点"完成", 课时不会自动消
      admin
        .from("lessons")
        .select("id, student_id, teacher_id, scheduled_at, duration_min")
          .eq("status", "scheduled")
          .lte("scheduled_at", new Date(Date.now() - 15 * 60000).toISOString())
          .gte("scheduled_at", ago(STALE_WINDOW_DAYS))
          .order("scheduled_at", { ascending: true })
        .limit(200),
      // 近 7 天已完课的, 用来找出"课上了但反馈没写"
      admin
        .from("lessons")
        .select("id, student_id, teacher_id, scheduled_at, completed_at")
        .eq("status", "completed")
        .gte("completed_at", ago(STALE_WINDOW_DAYS))
        .order("completed_at", { ascending: false })
        .limit(200),
      // 线索含家长手机号, 老师不发这个查询。
      isAdmin
        ? admin
            .from("leads")
            .select(
              "id, parent_name, parent_phone, child_name, intended_course, trial_date, created_at",
            )
            .eq("status", "new")
            .order("created_at", { ascending: true })
            .limit(50)
        : Promise.resolve({ data: [] }),
    ]);
    const renewalPacks = isAdmin ? await loadRenewalPackages(admin) : [];
    const balanceRes = isAdmin ? await admin.from('student_balance').select('student_id,remaining_hours').lt('remaining_hours', 0).limit(200) : { data: [] };
    if (balanceRes.error) throw balanceRes.error;
    const balances = balanceRes.data || [];

    // 可见性过滤：老师只看自己名下的学员
    const leaves = (leaveRes.data ?? []).filter((r) => scoped([r.student_id]).length);
    const makeups = (makeupRes.data ?? []).filter((r) => scoped([r.student_id]).length);
    const overdue = (overdueRes.data ?? []).filter(
      (r) =>
        scoped([r.student_id]).length &&
        (req.context.role !== "teacher" || r.teacher_id === req.context.userId) &&
        Date.parse(r.scheduled_at) + (Number(r.duration_min) || 60) * 60000 + 15 * 60000 <=
          Date.now(),
    );
    const completed = (completedRes.data ?? []).filter(
      (r) =>
        scoped([r.student_id]).length &&
        (req.context.role !== "teacher" || r.teacher_id === req.context.userId),
    );
    // 完课但没写反馈: 用 records 的 lesson_id 集合做差集
    const lessonIds = completed.map((l) => l.id);
    const reported = new Set();
    if (lessonIds.length) {
      const { data: recs, error: feedError } = await admin
        .from("parent_feeds")
        .select("records:record_id!inner(lesson_id)")
        .in("records.lesson_id", lessonIds);
      if (feedError) throw feedError;
      for (const r of recs ?? []) {
        const record = Array.isArray(r.records) ? r.records[0] : r.records;
        reported.add(record?.lesson_id || r.lesson_id);
      }
    }
    const noFeedback = completed.filter((l) => !reported.has(l.id)).slice(0, 200);

    const renewalById = new Map();
    if (isAdmin) {
      // 续费口径复用定时提醒的判定, 并以 student_balance 视图作为真实余额,
      // 保证运营中心、财务页、/me/renewal 和定时任务不会互相打脸。
      const { pickRenewalAlerts } = require("../src/scheduled.js");
      const { getSettings } = require("../lib/institutionSettings.js");
      const activePacks = (renewalPacks ?? []).filter((p) => p.students?.status === "active");
      const actualPacks = activePacks.length
        ? await withStudentBalances(admin, activePacks)
        : [];
      const renewalRaw = pickRenewalAlerts(actualPacks, Date.now(), await getSettings());
      for (const a of renewalRaw) {
        const sid = a.pack?.student_id;
        if (!sid || renewalById.has(sid)) continue; // 一人只出现一次
        renewalById.set(sid, {
          id: sid,
          remaining_hours: Number(a.balance ?? 0),
          sub: a.pack?.expires_at
            ? `到期 ${String(a.pack.expires_at).slice(0, 10)}`
            : `剩 ${Number(a.balance ?? 0)}h`,
        });
      }
    }
    const renewalIds = [...renewalById.keys()];

    const nameIds = [
      ...leaves.map((r) => r.student_id),
      ...makeups.map((r) => r.student_id),
      ...overdue.map((r) => r.student_id),
      ...noFeedback.map((r) => r.student_id),
      ...balances.map((r) => r.student_id),
      ...renewalIds,
    ];
    const nameMap = await studentNames(admin, nameIds);

    const groups = [];

    groups.push(
      group({
        key: "pending_leave",
        kind: "leave",
        severity: "danger",
        title: "待审批请假",
        hint: "家长/老师提交后还没处理，批准才会生成补课单",
        link: "/leave",
        items: leaves.map((r) => ({
          id: r.id,
          name: nameMap.get(r.student_id) ?? "?",
          sub: r.reason ? String(r.reason).slice(0, 30) : "未填原因",
          at: r.created_at,
        })),
      }),
    );

    groups.push(
      group({
        key: "pending_makeup",
        kind: "makeup",
        severity: "warning",
        title: "待安排补课",
        hint: "已批准的请假需要排补课时间，否则课时就白扣了",
        link: "/leave",
        items: makeups.map((r) => ({
          id: r.id,
          name: nameMap.get(r.student_id) ?? "?",
          sub: "未排期",
          at: r.created_at,
        })),
      }),
    );

    groups.push(
      group({
        key: "overdue_lesson",
        kind: "lesson",
        severity: "warning",
        title: "待确认完课",
        hint: "课程结束超过15分钟仍未确认，确认后家长可看到上课记录",
        link: "/schedule",
        items: overdue.map((r) => ({
          id: r.id,
          name: nameMap.get(r.student_id) ?? "?",
          sub: r.scheduled_at ? String(r.scheduled_at).slice(5, 16).replace("T", " ") : "",
          at: r.scheduled_at,
        })),
      }),
    );

    groups.push(
      group({
        key: "missing_feedback",
        kind: "report",
        severity: "warning",
        title: "待发送上课确认",
        hint: "已完课但家长尚看不到上课确认，点击补发即可，无需长评语",
        link: "/schedule",
        items: noFeedback.map((r) => ({
          id: r.id,
          name: nameMap.get(r.student_id) ?? "?",
          sub: r.completed_at ? String(r.completed_at).slice(5, 16).replace("T", " ") : "",
          at: r.completed_at,
        })),
      }),
    );

    // 线索只有管理员能看(含家长手机号), 老师不给
    if (req.context.role === "admin") {
      groups.push(
        group({
          key: "new_lead",
          kind: "lead",
          severity: "danger",
          title: "新线索未跟进",
          hint: "家长填了试听报名，24 小时内要回电",
          link: "/admin/leads",
          items: (leadRes.data ?? []).map((r) => ({
            id: r.id,
            name: r.parent_name ?? "?",
            sub: r.child_name
              ? `${r.child_name} · ${r.intended_course || "未填意向"}`
              : (r.parent_phone ?? ""),
            at: r.created_at,
          })),
        }),
      );
    }

    if (isAdmin) {
      groups.push(
        group({
          key: "renewal",
          kind: "finance",
          severity: "info",
          title: "待续费学员",
          hint: "课时不足或临近到期，该主动联系了",
          link: "/admin/finance",
          items: [...renewalById.values()].map((r) => ({
            id: r.id,
            name: nameMap.get(r.id) ?? "?",
            sub: r.sub,
            at: null,
          })),
        }),
      );

      groups.push(
        group({
          key: "negative_balance",
          kind: "finance",
          severity: "danger",
          title: "课时为负",
          hint: "余额已透支，多半是销课与充值没对上",
          link: "/admin/finance",
          items: balances.map((r) => ({
            id: r.student_id,
            name: nameMap.get(r.student_id) ?? "?",
            sub: `${Number(r.remaining_hours).toFixed(2)}h`,
            at: null,
          })),
        }),
      );
    }

    // 空的分组也保留(count=0), 前端据此显示"全部清空"的状态, 而不是留白让人以为加载失败
    if (req.context.role === "admin") {
      const pending = await admin
        .from("lessons")
        .select("id,student_id,scheduled_at,absence_review_status,students:student_id(full_name)", {
          count: "exact",
        })
        .eq("absence_review_status", "pending")
        .order("scheduled_at")
        .range(0, 7);
      if (pending.error) throw pending.error;
      const rows = Array.isArray(pending.data)
        ? pending.data.filter((l) => l.absence_review_status === "pending")
        : [];
      const item = group({
        key: "absence_review",
        kind: "finance",
        severity: "warning",
        title: "缺勤结算待确认",
        hint: "逐节确认是否扣学生课时及是否计教师课酬",
        link: "/admin/class-records?review=pending",
        items: rows.map((l) => ({
          id: l.id,
          name: l.students?.full_name || "学生",
          at: l.scheduled_at,
          sub: "缺勤结算待确认",
        })),
      });
      item.count = rows.length && Number.isFinite(pending.count) ? pending.count : rows.length;
      groups.push(item);
    }
    const order = { danger: 0, warning: 1, info: 2 };
    groups.sort(
      (a, b) =>
        order[a.severity] - order[b.severity] ||
        (a.key === "absence_review" ? -1 : b.key === "absence_review" ? 1 : b.count - a.count),
    );
    const open = groups.filter((g) => g.count > 0);

    ok(res, {
      generated_at: new Date().toISOString(),
      groups,
      summary: {
        total: open.reduce((s, g) => s + g.count, 0),
        openKinds: open.length,
        danger: open.filter((g) => g.severity === "danger").reduce((s, g) => s + g.count, 0),
      },
    });
  })(req, res);
};
