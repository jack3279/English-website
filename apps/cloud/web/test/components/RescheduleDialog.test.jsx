import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RescheduleDialog from "../../src/features/schedule/RescheduleDialog.jsx";
import { http } from "../../src/lib/http.js";
const state = vi.hoisted(() => ({ rows: [], loading: false, role: "admin" }));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: () => ({ data: state.rows, isLoading: state.loading }),
}));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: state.role } }),
}));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn().mockResolvedValue({ data: {} }) }));
const lesson = {
  id: "l1",
  teacher_id: "t1",
  student_id: "s1",
  status: "scheduled",
  scheduled_at: "2026-10-09T08:00:00Z",
  duration_min: 60,
  students: { full_name: "Lily" },
  profiles: { full_name: "Emma" },
};
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  state.rows = [];
  state.loading = false;
  state.role = "admin";
  vi.clearAllMocks();
});
function renderDialog(props = {}) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RescheduleDialog
        lesson={lesson}
        proposedAt="2026-10-10T08:00:00Z"
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return onClose;
}
test("拖动后的提议仅显示确认窗口，放弃不会提交任何更改", () => {
  const closed = renderDialog();
  expect(screen.getByLabelText("新上课时间（北京时间）")).toHaveValue("2026-10-10T16:00");
  expect(http).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "放弃调整" }));
  expect(closed).toHaveBeenCalledTimes(1);
  expect(http).not.toHaveBeenCalled();
});
test("确认前可微调具体时间，保存提交正确的北京时间对应 UTC", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("新上课时间（北京时间）"), {
    target: { value: "2026-10-10T17:15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认调课" }));
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith("/lessons/l1", {
      method: "PATCH",
      body: { scheduled_at: "2026-10-10T09:15:00.000Z" },
    }),
  );
});
test("浏览器日期输入事件同步更新结束时间预览", () => {
  renderDialog({ proposedAt: lesson.scheduled_at });
  fireEvent.input(screen.getByLabelText("新上课时间（北京时间）"), {
    target: { value: "2026-10-09T16:30" },
  });
  expect(screen.getByText(/预计结束/)).toHaveTextContent("17:30");
  expect(screen.getByRole("button", { name: "确认调课" })).toBeEnabled();
});
test("有真实重叠时不能确认", () => {
  state.rows = [{ ...lesson, id: "other", student_id: "s2", scheduled_at: "2026-10-10T08:30:00Z" }];
  renderDialog();
  expect(screen.getByRole("button", { name: "确认调课" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("已有课程重叠");
});
test("预检查加载期间不能提前保存", () => {
  state.loading = true;
  renderDialog();
  expect(screen.getByRole("button", { name: "确认调课" })).toBeDisabled();
});
test("管理员调整时长时沿用管理员排课更新接口", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("课程时长（分钟）"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "确认调课" }));
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith("/schedules/l1", {
      method: "PATCH",
      body: {
        scheduled_at: "2026-10-10T08:00:00.000Z",
        duration_min: 90,
        teacher_id: "t1",
        student_id: "s1",
      },
    }),
  );
});
test("老师调整自己的时间时不能编辑课程时长", () => {
  state.role = "teacher";
  renderDialog();
  expect(screen.getByLabelText("课程时长（分钟）")).toBeDisabled();
});
