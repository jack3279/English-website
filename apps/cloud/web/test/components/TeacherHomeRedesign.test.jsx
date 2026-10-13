import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TodayLessonsPage from "../../src/features/lessons/TodayLessonsPage.jsx";
const state = vi.hoisted(() => ({ lessons: [] }));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: () => ({ data: state.lessons }),
}));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: "teacher", full_name: "老师甲" } }),
}));
vi.mock("../../src/features/lessons/useCompleteLesson.js", () => ({
  useCompleteLesson: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../src/features/lessons/LessonCard.jsx", () => ({
  default: ({ lesson, onAttendance }) => (
    <div>
      {lesson.status}课节
      {lesson.status === "scheduled" && (
        <button type="button" onClick={() => onAttendance(lesson)}>
          课程点名
        </button>
      )}
    </div>
  ),
}));
vi.mock("../../src/features/lessons/AttendanceModal.jsx", () => ({
  default: ({ lesson, onPresent }) => (
    <div>
      点名弹窗-{lesson.id}
      <button type="button" onClick={() => onPresent(lesson)}>
        到课
      </button>
    </div>
  ),
}));
vi.mock("../../src/features/lessons/LessonCompleteModal.jsx", () => ({
  default: ({ lesson }) => <div>完课弹窗-{lesson.id}</div>,
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/lib/http.js", () => ({ http: async () => ({ data: {} }) }));
let client;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TodayLessonsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
});
test("教师首页聚焦下一节待上课程，取消课程不会成为下一节", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-10T09:00:00Z"));
  state.lessons = [
    {
      id: "cancel",
      status: "cancelled",
      scheduled_at: "2026-10-10T09:10:00Z",
      duration_min: 60,
      students: { full_name: "取消学员" },
    },
    {
      id: "next",
      status: "scheduled",
      scheduled_at: "2026-10-10T09:30:00Z",
      duration_min: 60,
      students: { full_name: "下一节学员" },
    },
  ];
  mount();
  expect(screen.getByRole("heading", { name: "下一节学员" })).toBeInTheDocument();
  expect(screen.getByText("下一节课程")).toBeInTheDocument();
  expect(screen.getByText("17:30 · 60 分钟")).toBeInTheDocument();
});
test("仅有取消或缺席课节时不显示全部完成", () => {
  state.lessons = [
    { id: "cancel", status: "cancelled" },
    { id: "absent", status: "no_show" },
  ];
  mount();
  expect(screen.queryByText(/课全部完成/)).not.toBeInTheDocument();
});

test("桌面端课程点名先打开点名弹窗，到课后才进入完课弹窗", () => {
  state.lessons = [
    {
      id: "today-lesson",
      status: "scheduled",
      scheduled_at: "2026-10-10T09:30:00Z",
      duration_min: 60,
      students: { full_name: "今日学员" },
    },
  ];
  mount();

  fireEvent.click(screen.getByRole("button", { name: "课程点名" }));
  expect(screen.getByText("点名弹窗-today-lesson")).toBeInTheDocument();
  expect(screen.queryByText("完课弹窗-today-lesson")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "到课" }));
  expect(screen.getByText("完课弹窗-today-lesson")).toBeInTheDocument();
});
