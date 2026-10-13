const { z } = require("zod");
const { webcrypto } = require("node:crypto");
const store = require("./secureStore.js");
const { getAdmin } = require("./supabase.js");
const { restInsert, restPatch } = require("./rest.js");
const { HttpError } = require("./errors.js");
const KEY = "private/lead-conversions/state-v1";
const Input = z
  .object({
    full_name: z.string().trim().min(1).max(50),
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    branch_id: z.string().uuid(),
    existing_student_id: z.string().uuid().nullable().optional().default(null),
    parent_id: z.string().uuid().nullable().optional().default(null),
    confirmed: z.literal(true),
    current_password: z.string().min(1).max(128),
  })
  .strict();
async function rows(query) {
  const { data, error } = await query;
  if (error) throw new HttpError(503, "CONVERSION_DATA_UNAVAILABLE", "建档资料暂时无法读取");
  return data;
}
async function mapping() {
  return store.ready() ? (await store.read(KEY, {})).value : {};
}
async function convert(req, id, body) {
  if (!z.string().uuid().safeParse(id).success)
    throw new HttpError(400, "BAD_REQUEST", "线索编号无效");
  const parsed = Input.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "CONVERSION_INVALID", "请确认学员、校区及监护关系");
  const input = parsed.data;
  if (
    input.birth_date &&
    (Number.isNaN(Date.parse(input.birth_date)) ||
      new Date(input.birth_date).toISOString().slice(0, 10) !== input.birth_date ||
      input.birth_date > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
  )
    throw new HttpError(400, "BIRTH_DATE_INVALID", "生日无效或晚于今天");
  await require("./adminConfirmation.js").verify(req, input.current_password);
  const lead = await rows(
    getAdmin()
      .from("leads")
      .select("id,status,child_name,intended_course")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!lead) throw new HttpError(404, "LEAD_NOT_FOUND", "线索不存在");
  const branch = await rows(
    getAdmin().from("branches").select("id").eq("id", input.branch_id).maybeSingle(),
  );
  if (!branch) throw new HttpError(404, "BRANCH_NOT_FOUND", "校区不存在");
  if (input.parent_id) {
    const parent = await rows(
      getAdmin()
        .from("parents")
        .select("id,profiles:profile_id(role)")
        .eq("id", input.parent_id)
        .maybeSingle(),
    );
    if (!parent || parent.profiles?.role !== "parent")
      throw new HttpError(404, "PARENT_NOT_FOUND", "没有找到有效的家长账号");
  }
  const { current_password, confirmed, ...details } = input;
  const fingerprint = await store.hash(JSON.stringify(details));
  const created = await store.change(KEY, {}, (records) => {
    if (records[id]) {
      if (records[id].fingerprint !== fingerprint)
        throw new HttpError(409, "CONVERSION_CHANGED", "该线索已有建档进度，请先核对原建档资料");
      return null;
    }
    return {
      ...records,
      [id]: {
        fingerprint,
        details,
        student_id: input.existing_student_id || (globalThis.crypto || webcrypto).randomUUID(),
        parent_id: input.parent_id,
        state: "pending",
        actor: req.context.userId,
        at: new Date().toISOString(),
      },
    };
  });
  const draft = created?.[id] || (await mapping())[id];
  if (draft.state === "done") return { student_id: draft.student_id, alreadyConverted: true };
  try {
    let student = await rows(
      getAdmin().from("students").select("id").eq("id", draft.student_id).maybeSingle(),
    );
    if (!student && input.existing_student_id)
      throw new HttpError(404, "STUDENT_NOT_FOUND", "所选学员不存在");
    if (!student) {
      try {
        const inserted = await restInsert("students", {
          id: draft.student_id,
          full_name: input.full_name,
          birth_date: input.birth_date,
          branch_id: input.branch_id,
          status: "active",
          notes: `招生建档${lead.intended_course ? ` · 意向：${lead.intended_course}` : ""}`,
        });
        if (!inserted.length)
          throw new HttpError(503, "STUDENT_INSERT_UNKNOWN", "档案创建结果未确认");
      } catch (error) {
        student = await rows(
          getAdmin().from("students").select("id").eq("id", draft.student_id).maybeSingle(),
        );
        if (!student) throw error;
      }
    }
    await store.change(KEY, {}, (records) => ({
      ...records,
      [id]: { ...records[id], studentCreated: true },
    }));
    if (input.parent_id) {
      const linked = await rows(
        getAdmin()
          .from("parent_student_links")
          .select("parent_id")
          .eq("student_id", draft.student_id)
          .eq("parent_id", input.parent_id)
          .limit(1),
      );
      if (!linked.length) {
        try {
          const inserted = await restInsert("parent_student_links", {
            student_id: draft.student_id,
            parent_id: input.parent_id,
            relation: "guardian",
          });
          if (!inserted.length)
            throw new HttpError(503, "PARENT_LINK_UNKNOWN", "监护关系保存结果未确认");
        } catch (error) {
          const persisted = await rows(
            getAdmin()
              .from("parent_student_links")
              .select("parent_id")
              .eq("student_id", draft.student_id)
              .eq("parent_id", input.parent_id)
              .limit(1),
          );
          if (!persisted.length) throw error;
        }
      }
    }
    const updated = await restPatch("leads", { id }, { status: "converted" });
    if (!updated.length) throw new HttpError(404, "LEAD_UPDATE_FAILED", "线索状态未能更新");
    const committed = await store.change(KEY, {}, (records) =>
      records[id]?.state === "done"
        ? null
        : {
            ...records,
            [id]: { ...records[id], state: "done", completed_at: new Date().toISOString() },
          },
    );
    if (committed)
      await require("./audit.js").record(
        req.context.userId,
        "lead.converted",
        "lead",
        id,
        { student_id: draft.student_id, parent_id: input.parent_id },
        req.reqId,
      );
    return { student_id: draft.student_id, parentLinked: !!input.parent_id };
  } catch (error) {
    if (error.status === 404) throw error;
    throw new HttpError(
      503,
      "CONVERSION_PENDING",
      "建档进度未完全确认。请刷新线索核对进度后，使用相同资料继续；不要重复新建学员",
    );
  }
}
module.exports = { convert, mapping };
