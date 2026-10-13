import { test, expect } from "vitest";
import { notificationLink } from "../src/lib/notificationLink.js";
test("历史站内信链接按角色转到当前可用页面", () => {
  expect(notificationLink("/messages", "parent")).toBe("/parent/letters");
  expect(notificationLink("/messages", "admin")).toBe("/admin/messages");
  expect(notificationLink("/messages", "teacher")).toBe("/teacher/letters");
  expect(notificationLink("/leave", "parent")).toBe("/leave");
});
