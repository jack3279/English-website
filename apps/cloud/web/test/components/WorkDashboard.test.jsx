import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminDashboardPage from "../../src/features/admin/AdminDashboardPage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/features/admin/DashboardCharts.jsx", () => ({
  default: () => <div>经营图表</div>,
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function renderBoard(failOps = false, lessons = []) {
  http.mockImplementation((path) => {
    if (path === "/operations")
      return failOps
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ data: { summary: { total: 3 } } });
    if (path === "/alerts") return Promise.resolve({ data: { low_balance: [], zero_balance: [] } });
    if (path.startsWith("/schedules?")) return Promise.resolve({ data: lessons });
    if (path === "/branches") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminDashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
test("工作台优先显示待办，经营图表在用户展开后加载", async () => {
  renderBoard();
  await screen.findByText("3 项待办需要处理");
  expect(screen.getByRole("link", { name: "查看待办" })).toHaveAttribute(
    "href",
    "/admin/operations",
  );
  expect(screen.queryByText("经营图表")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("经营分析"));
  expect(await screen.findByText("经营图表")).toBeInTheDocument();
});
test("待办加载失败不会被误报成已经处理完", async () => {
  renderBoard(true);
  expect(
    (await screen.findAllByRole("alert")).some((e) => e.textContent.includes("今日待办加载失败")),
  ).toBe(true);
  expect(screen.queryByText("今日待办已处理完")).not.toBeInTheDocument();
});

test("今日排课统计排除取消课程，保留取消状态便于教务核对", async () => {
  renderBoard(false, [
    {
      id: "1",
      student_id: "s1",
      students: { full_name: "学生A" },
      scheduled_at: "2026-10-09T08:00:00Z",
      status: "scheduled",
      duration_min: 60,
    },
    {
      id: "2",
      students: { full_name: "学生B" },
      scheduled_at: "2026-10-09T09:00:00Z",
      status: "completed",
      duration_min: 30,
    },
    {
      id: "3",
      students: { full_name: "学生C" },
      scheduled_at: "2026-10-09T10:00:00Z",
      status: "cancelled",
      duration_min: 120,
    },
  ]);
  expect(await screen.findByText(/今日已排 1.5 小时/)).toBeInTheDocument();
  expect(screen.getByText("已取消")).toBeInTheDocument();
  expect(screen.getByText("学生A")).toBeInTheDocument();
});
