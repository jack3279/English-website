const { z } = require("zod");

const Record = z.object({
  id: z.string().uuid(),
  lesson_id: z.string().uuid(),
  content: z.string(),
  performance: z.string().nullable(),
  homework: z.string().nullable(),
  next_plan: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
});

module.exports = { Record };
