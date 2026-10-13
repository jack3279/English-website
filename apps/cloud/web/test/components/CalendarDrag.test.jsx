import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WeekGrid from "../../src/features/schedule/WeekGrid.jsx";
afterEach(cleanup);
test("拖动课程只产生可确认的日期提议，已取消课程不能拖动", () => {
  const moved = vi.fn();
  const lesson = {
    id: "l1",
    status: "scheduled",
    teacher_id: "t1",
    student_id: "s1",
    scheduled_at: new Date(2026, 9, 5, 16).toISOString(),
    duration_min: 60,
    students: { full_name: "Lily" },
    profiles: { full_name: "Emma" },
  };
  const { container } = render(
    <WeekGrid
      anchor={new Date(2026, 9, 5)}
      lessons={[lesson, { ...lesson, id: "cancelled", status: "cancelled" }]}
      onReschedule={moved}
    />,
  );
  const cancelled = screen.getAllByRole("button", { name: /已取消/ });
  expect(cancelled[0]).toHaveAttribute("draggable", "false");
  const dayColumns = container.querySelectorAll('[class*="min-h-[200px]"]');
  fireEvent.drop(dayColumns[1], { dataTransfer: { getData: () => "l1" } });
  expect(moved).toHaveBeenCalledTimes(1);
  expect(moved.mock.calls[0][1].proposedAt).toBe(new Date(2026, 9, 6, 16).toISOString());
});
