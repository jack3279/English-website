// 课节变更通知（改期/取消）—— 唯一实现。
//
// 抽取原因：原实现私有在 routes/schedules.js，但 routes/lessons.js 的 PATCH /lessons/:id
// （老师拖拽改期走这条）也需要它。两条路径曾各写一份，导致「管理员改会通知、老师改不通知」。
// ⚠️ 调用前必须先查出 lesson 及其 student/teacher 关系字段（students / profiles / duration_min）。

const notify = require("./notify.js");
const wecom = require("../src/wecom.js");
const { warn } = require("./log.js");
const { fmtWhenShanghai } = require("./window.js");

async function notifyLessonChanged(
  req,
  lesson,
  { cancelled = false, previousAt = null, previousDuration = null } = {},
) {
  if (!lesson) return;
  const when = fmtWhenShanghai(lesson.scheduled_at);
  const who = lesson.students?.full_name || "学员";
  const type = cancelled ? "lesson_cancelled" : "lesson_rescheduled";
  const title = cancelled ? "课程已取消" : "课程时间有变";
  const durationNote =
    previousDuration != null &&
    Number(lesson.duration_min) > 0 &&
    Number(previousDuration) !== Number(lesson.duration_min)
      ? `；时长从 ${previousDuration} 分钟调整为 ${lesson.duration_min} 分钟`
      : "";
  const body =
    (cancelled
      ? `${who} ${when} 的课已取消${lesson.duration_min ? `（${lesson.duration_min} 分钟）` : ""}`
      : previousAt
        ? `${who} 的课从 ${fmtWhenShanghai(previousAt)} 改到 ${when}`
        : `${who} 的课已调整到 ${when}`) + (cancelled ? "" : durationNote);
  const ctx = {
    reqId: req.reqId,
    source: `schedules.${cancelled ? "cancel" : "update"}`,
    lessonId: lesson.id,
  };

  await notify.pushToParents(lesson.student_id, { type, title, body, link: "/parent" }, ctx);

  // 同步推企业微信 (外部联系人, 家长) —— 任一通道失败不影响另一通道, 也不影响主流程。
  // WeCom 没配置 (extEnabled=false) 时 runBatch 内部所有任务都 skipped, 直接返回空结果。
  if (wecom.extEnabled && wecom.extEnabled()) {
    const extId = await notify.parentExternalId(lesson.student_id);
    if (extId) {
      try {
        const jobs = cancelled
          ? wecom.lessonCancelledJobs({
              parentWecomIds: [extId],
              payload: {
                studentName: who,
                scheduledAt: lesson.scheduled_at,
                durationMin: lesson.duration_min,
              },
            })
          : wecom.lessonChangedJobs({
              parentWecomIds: [extId],
              payload: {
                studentName: who,
                fromAt: previousAt || lesson.scheduled_at,
                toAt: lesson.scheduled_at,
                changeNote: durationNote,
              },
            });
        await wecom.runBatch(jobs);
      } catch (e) {
        warn("notify_wecom_failed", { ...ctx, err: e && e.message });
      }
    }
  }

  if (lesson.teacher_id) {
    try {
      await notify.push(
        {
          type,
          title,
          body,
          target_user: lesson.teacher_id,
          student_id: lesson.student_id,
          link: "/teacher/today",
        },
        ctx,
      );
    } catch (e) {
      warn("notify_teacher_failed", { ...ctx, err: e && e.message });
    }
  }
}

module.exports = { notifyLessonChanged };
