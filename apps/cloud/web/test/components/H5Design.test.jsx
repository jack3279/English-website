import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MobileBottomNav } from "../../src/layout/MobileBottomNav.jsx";
import LessonCard from "../../src/features/lessons/LessonCard.jsx";
vi.mock("../../src/features/notifications/useNotifications.js", () => ({
  useUnreadCount: () => ({ data: 0 }),
}));
afterEach(cleanup);
test("老师手机导航有工作台课表消息我的，消息不会指向管理员页面", () => {
  render(
    <MemoryRouter initialEntries={["/teacher/today"]}>
      <MobileBottomNav role="teacher" />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.getByRole("link", { name: "消息" })).toHaveAttribute("href", "/inbox");
  expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute("aria-current", "page");
});
test("家长导航指向孩子页面，管理员导航包含待办", () => {
  const { rerender } = render(
    <MemoryRouter>
      <MobileBottomNav role="parent" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "孩子" })).toHaveAttribute("href", "/parent");
  rerender(
    <MemoryRouter>
      <MobileBottomNav role="admin" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "待办" })).toHaveAttribute("href", "/admin/operations");
  expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute("href", "/admin");
});
test("课程卡显示北京时间起止及取消状态，取消的课不能点名", () => {
  const action = vi.fn(),
    lesson = {
      id: "1",
      status: "cancelled",
      scheduled_at: "2026-10-09T08:00:00Z",
      duration_min: 90,
      students: { full_name: "Lily" },
    };
  const { rerender } = render(<LessonCard lesson={lesson} onAttendance={action} />);
  expect(screen.getByText("16:00–17:30")).toBeInTheDocument();
  expect(screen.getByText("已取消")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<LessonCard lesson={{ ...lesson, status: "scheduled" }} onAttendance={action} />);
  fireEvent.click(screen.getByRole("button", { name: "课程点名" }));
  expect(action).toHaveBeenCalledOnce();
});
