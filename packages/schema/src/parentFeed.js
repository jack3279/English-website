const { z } = require("zod");

const ParentFeed = z.object({
  id: z.string().uuid(),
  record_id: z.string().uuid(),
  student_id: z.string().uuid(),
  summary: z.string(),
  published_at: z.string().datetime(),
});

module.exports = { ParentFeed };
