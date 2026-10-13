import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MonthGrid from "../../src/features/schedule/MonthGrid.jsx";
afterEach(cleanup);
test("月视图保留取消标记和课节身份，拥挤日期可展开全部课节", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `l${index}`,
    scheduled_at: new Date(2026, 8, 30, 10 + index).toISOString(),
    duration_min: 60,
    status: index === 0 ? "cancelled" : "scheduled",
    students: { full_name: index === 0 ? "Lily" : `学生${index}` },
    profiles: { full_name: "Emma" },
  }));
  render(<MonthGrid anchor={new Date(2026, 9, 8)} lessons={rows} onLessonClick={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Lily 已取消/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "另有 1 节…" }));
  expect(screen.getByRole("dialog", { name: "9月30日的课程" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /学生3/ })).toBeInTheDocument();
});
