import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SchedulePage from "../../src/features/schedule/SchedulePage.jsx";
import { useSchedule } from "../../src/features/schedule/useSchedule.js";
import { http } from "../../src/lib/http.js";

vi.mock("../../src/lib/http.js", () => ({ http: vi.fn(async () => ({ data: [] })) }));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { id: "admin", role: "admin" } }),
}));
vi.mock("../../src/features/admin/InstitutionContext.jsx", () => ({
  useInstitution: () => ({ rules: { loadLimits: {} }, loading: false, error: null }),
}));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: vi.fn(() => ({ data: [] })),
}));
vi.mock("../../src/features/schedule/TeacherAvailabilityPanel.jsx", () => ({
  default: () => <div>教师空闲面板</div>,
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({ PageHeader: () => <h1>课程表</h1> }));
vi.mock("../../src/components/MoreActions.jsx", () => ({ MoreActions: () => null }));
vi.mock("../../src/features/schedule/WeekGrid.jsx", () => ({ default: () => <div>周视图</div> }));
vi.mock("../../src/features/schedule/MonthGrid.jsx", () => ({ default: () => <div>月视图</div> }));
vi.mock("../../src/features/schedule/TeacherWeekGrid.jsx", () => ({
  default: () => <div>教师视图</div>,
}));
vi.mock("../../src/features/schedule/StudentWeekGrid.jsx", () => ({
  default: () => <div>学员视图</div>,
}));
vi.mock("../../src/features/schedule/MobileScheduleList.jsx", () => ({
  default: () => <div>手机课表</div>,
}));
vi.mock("../../src/features/schedule/AxisFilter.jsx", () => ({ default: () => null }));
vi.mock("../../src/features/schedule/ScheduleChecks.jsx", () => ({ default: () => null }));
vi.mock("../../src/features/schedule/LessonDetailModal.jsx", () => ({ default: () => null }));
vi.mock("../../src/features/schedule/RescheduleDialog.jsx", () => ({ default: () => null }));

let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SchedulePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function historyCall() {
  return useSchedule.mock.calls
    .map(([options]) => options)
    .findLast((options) => options.statuses?.includes("no_show"));
}

test("历史课节只在周视图查询，切到月视图后停用", () => {
  mount();
  expect(historyCall().enabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /月视图/ }));
  expect(historyCall().enabled).toBe(false);
});

test("教师空闲面板默认不挂载，展开后才加载", async () => {
  mount();
  expect(screen.queryByText("教师空闲面板")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("查看教师空闲与个人占用时间"));
  expect(await screen.findByText("教师空闲面板")).toBeInTheDocument();
  expect(http).not.toHaveBeenCalledWith(expect.stringContaining("/teacher-availability/"));
});
