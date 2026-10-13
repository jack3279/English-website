import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ParentFeedsPage from "../../src/features/parent-h5/ParentFeedsPage.jsx";
import ClassRecordsPage from "../../src/features/admin/ClassRecordsPage.jsx";
import TeacherFeedbackPage from "../../src/features/lessons/TeacherFeedbackPage.jsx";
import PayrollSettlementAction from "../../src/features/admin/PayrollSettlementAction.jsx";
import { http } from "../../src/lib/http.js";
const data = vi.hoisted(() => ({ lessons: [] }));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/features/parent-h5/FeedList.jsx", () => ({
  default: ({ studentId }) => <div>反馈对象:{studentId}</div>,
}));
vi.mock("../../src/features/schedule/useSchedule.js", () => ({
  useSchedule: () => ({ data: data.lessons, isPending: false }),
}));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { id: "teacher", role: "teacher" } }),
}));
vi.mock("react-router-dom", async (original) => ({
  ...(await original()),
  useParams: () => ({ id: "lesson" }),
}));
vi.mock("../../src/features/lessons/useCompleteLesson.js", () => ({
  useCompleteLesson: () => ({ mutateAsync: vi.fn() }),
}));
let client;
function mount(component, url = "/") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
test("家长反馈页的外部学员参数不能切换到不在本人名单中的孩子", async () => {
  http.mockResolvedValue({ data: [{ id: "own-child", full_name: "我的孩子" }] });
  mount(<ParentFeedsPage />, "/parent/feeds?studentId=other-child");
  expect(await screen.findByText("反馈对象:own-child")).toBeInTheDocument();
  expect(screen.queryByText("反馈对象:other-child")).not.toBeInTheDocument();
});
test("上课记录出勤率只按已登记课程计算，未上和取消不制造缺勤", () => {
  data.lessons = ["completed", "no_show", "cancelled", "scheduled"].map((status, i) => ({
    id: String(i),
    student_id: "child",
    status,
    scheduled_at: "2026-10-10T09:00:00Z",
    duration_min: 60,
  }));
  mount(<ClassRecordsPage />);
  expect(screen.getByText("50.0%")).toBeInTheDocument();
  expect(screen.getByText(/待上课和取消课节不计入/)).toBeInTheDocument();
});
test("独立反馈页不能把已完成课程再次消课", async () => {
  http.mockResolvedValue({ data: { id: "lesson", teacher_id: "teacher", status: "completed" } });
  mount(<TeacherFeedbackPage />);
  await screen.findByText(/该课节已有考勤结果/);
  expect(screen.queryByRole("button", { name: /保存点名及上课记录/ })).not.toBeInTheDocument();
});
test("发放登记必须明确确认外部付款，并携带所见金额以防并发变价", async () => {
  http.mockResolvedValue({ data: {} });
  mount(
    <PayrollSettlementAction
      row={{
        teacher_id: "teacher",
        teacher_name: "老师",
        month: "2026-10-01",
        pay_amount: 100,
        pay_currency: "PHP",
      }}
      records={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "登记已发放" }));
  expect(screen.getByRole("button", { name: "确认记录" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("当前管理员密码"), {
    target: { value: "mock-current-password" },
  });
  fireEvent.click(screen.getByLabelText(/我确认已通过外部渠道实际发放/));
  fireEvent.click(screen.getByRole("button", { name: "确认记录" }));
  expect(http).toHaveBeenCalledWith(
    "/finance/payroll/settlements",
    expect.objectContaining({
      body: expect.objectContaining({
        expected_amount_cents: 10000,
        expected_currency: "PHP",
        confirmed: true,
      }),
    }),
  );
});
