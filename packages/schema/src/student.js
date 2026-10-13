const { z } = require("zod");

const Student = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  birth_date: z.string().nullable(),
  branch_id: z.string().uuid().nullable(),
  // 在读 active / 停课 inactive / 休学 leave / 结课 graduated / 退费 refunded；仅 active 参与提醒。
  status: z.string(),
  notes: z.string().nullable().optional(),
});

const StudentBalance = z.object({
  student_id: z.string().uuid(),
  remaining_hours: z.number(),
});

module.exports = { Student, StudentBalance };
