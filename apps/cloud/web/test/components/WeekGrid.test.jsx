import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WeekGrid from "../../src/features/schedule/WeekGrid.jsx";

vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
afterEach(cleanup);

function renderGrid(hideStudent = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WeekGrid
        anchor={new Date(2026, 9, 5)}
        draggable={false}
        hideStudent={hideStudent}
        lessons={[
          {
            id: "lesson",
            scheduled_at: new Date(2026, 9, 5, 10).toISOString(),
            status: "scheduled",
            duration_min: 60,
            students: { full_name: "学员甲" },
            profiles: { full_name: "Teacher" },
          },
        ]}
      />
    </QueryClientProvider>,
  );
}

test("有课程的手机和桌面周视图正常显示学员", () => {
  renderGrid();
  expect(screen.getAllByText("学员甲")).toHaveLength(2);
});

test("家长周视图隐藏学员姓名并显示我", () => {
  renderGrid(true);
  expect(screen.queryByText("学员甲")).not.toBeInTheDocument();
  expect(screen.getAllByText("我")).toHaveLength(2);
});
