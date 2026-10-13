const { z } = require("zod");

const LessonStatus = z.enum(["scheduled", "completed", "cancelled", "no_show"]);
const LeaveStatus = z.enum(["pending", "approved", "rejected"]).nullable();

const Lesson = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid().nullable(),
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  duration_min: z.number().int().positive(),
  status: LessonStatus,
  completed_at: z.string().datetime().nullable(),
  leave_status: LeaveStatus,
  leave_reason: z.string().nullable(),
});

const CompleteLessonInput = z.object({
  content: z.string().min(1).max(5000),
  performance: z.string().max(2000).optional().default(""),
  homework: z.string().max(2000).optional().default(""),
  next_plan: z.string().max(2000).optional().default(""),
  publishToParent: z.boolean().default(true),
});

const CreateScheduleInput = z.object({
  course_id: z.string().uuid().optional(),
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  duration_min: z.number().int().positive().default(60),
});

const UpdateScheduleInput = z.object({
  scheduled_at: z.string().datetime().optional(),
  teacher_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
  status: LessonStatus.optional(),
  duration_min: z.number().int().positive().optional(),
});

module.exports = { Lesson, CompleteLessonInput, CreateScheduleInput, UpdateScheduleInput };
