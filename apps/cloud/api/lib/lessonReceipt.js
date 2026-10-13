const { getAdmin } = require("./supabase.js");
const { restInsert } = require("./rest.js");
const { HttpError } = require("./errors.js");
const { withLock } = require("./workflowLock.js");
const store = require("./secureStore.js");
const BASIC = "本节课程已完成。此为上课确认，未填写详细学习反馈。";
async function publish(req, id) {
  if (!["admin", "teacher"].includes(req.context.role))
    throw new HttpError(403, "FORBIDDEN", "无发布权限");
  return withLock(`lesson-${id}`, async () => {
    const found = await getAdmin()
      .from("lessons")
      .select("id,student_id,teacher_id,status")
      .eq("id", id)
      .maybeSingle();
    if (found.error) throw new HttpError(503, "RECEIPT_UNAVAILABLE", "课节读取失败");
    const lesson = found.data;
    if (!lesson) throw new HttpError(404, "LESSON_NOT_FOUND", "课节不存在");
    if (req.context.role === "teacher" && lesson.teacher_id !== req.context.userId)
      throw new HttpError(403, "FORBIDDEN", "只能发送自己课程的上课确认");
    if (lesson.status !== "completed")
      throw new HttpError(409, "LESSON_NOT_COMPLETED", "请先确认完课，不会自动消课或更改课酬");
    const recordResult = await getAdmin()
      .from("records")
      .select("*")
      .eq("lesson_id", id)
      .maybeSingle();
    if (recordResult.error) throw new HttpError(503, "RECEIPT_UNAVAILABLE", "反馈读取失败");
    let record = recordResult.data;
    if (!record) {
      const h = await store.hash(`receipt-record:${id}`),
        recordId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
      const rows = await restInsert("records", {
        id: recordId,
        lesson_id: id,
        content: BASIC,
        performance: "",
        homework: "",
        next_plan: "",
        created_by: req.context.userId,
      });
      if (!rows?.length)
        throw new HttpError(503, "RECEIPT_UNAVAILABLE", "上课确认保存未确认，请重试");
      record = rows[0];
    }
    const existing = await getAdmin()
      .from("parent_feeds")
      .select("id")
      .eq("record_id", record.id)
      .maybeSingle();
    if (existing.error) throw new HttpError(503, "RECEIPT_UNAVAILABLE", "发送状态读取失败");
    if (existing.data) return { published: true, idempotent: true };
    const summary = require("@cloud/domain").buildSummary(record);
    const rows = await restInsert("parent_feeds", {
      record_id: record.id,
      student_id: lesson.student_id,
      summary,
      published_at: new Date().toISOString(),
    });
    if (!rows?.length)
      throw new HttpError(503, "RECEIPT_UNAVAILABLE", "上课确认发布未确认，请重试");
    await require("./notify.js").pushToParents(
      lesson.student_id,
      {
        type: "report",
        title: record.content === BASIC ? "上课确认" : "新的课后反馈",
        body: summary,
        link: "/parent",
      },
      { reqId: req.reqId, source: "lesson.receipt" },
    );
    await require("./audit.js").record(
      req.context.userId,
      "lesson.receipt",
      "lesson",
      id,
      { record_id: record.id },
      req.reqId,
    );
    return { published: true, id: rows[0].id };
  });
}
module.exports = { publish, BASIC };
