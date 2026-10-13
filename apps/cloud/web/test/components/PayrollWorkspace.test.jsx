import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayrollWorkspace from "../../src/features/admin/PayrollWorkspace.jsx";
import { http } from "../../src/lib/http.js";
import { exportPayrollWorkbook } from "../../src/lib/xlsx.js";
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/lib/xlsx.js", () => ({ exportPayrollWorkbook: vi.fn() }));
const teacher = "22222222-2222-4222-8222-222222222222";
let client;
function mount(readOnly = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <PayrollWorkspace readOnly={readOnly} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function fixture() {
  http.mockImplementation(async (path) => ({
    data:
      path === "/teachers"
        ? [{ profile_id: teacher, full_name: "教师甲", hourly_pay: 12, pay_currency: "USD" }]
        : path === "/finance/payroll/pricing"
          ? { teachers: {} }
          : path === "/courses"
            ? { items: [] }
            : path.startsWith("/students")
              ? []
              : path.includes("/settlements")
                ? { records: [], storageReady: true }
                : {
                    rows: [
                      {
                        teacher_id: teacher,
                        teacher_name: "教师甲",
                        period: "monthly",
                        period_from: "2026-10-01",
                        period_to: "2026-10-31",
                        cycle: "weekly",
                        pay_amount: 18,
                        pay_currency: "USD",
                        minutes_done: 90,
                        lessons_done: 1,
                      },
                    ],
                    details: [
                      {
                        lesson_id: "lesson",
                        day: "2026-10-10",
                        teacher_name: "教师甲",
                        student_name: "学生甲",
                        course_name: "口语",
                        duration_min: 90,
                        hourly_pay: 12,
                        pay_amount: 18,
                        pay_currency: "USD",
                        student_price: 150,
                        student_amount: 225,
                      },
                    ],
                    totals: { by_currency: { USD: 18 }, lessons_done: 1, hours: 1.5 },
                    range: { from: "2026-10-01", to: "2026-10-10" },
                    storageReady: true,
                  },
  }));
}
test("教师与学生选择器接受真实接口数组，设置默认币种与周结", async () => {
  fixture();
  mount();
  await waitFor(() => expect(screen.getByRole("button", { name: "价格设置" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "价格设置" }));
  await screen.findByRole("dialog");
  expect(screen.getByLabelText("默认时薪")).toHaveValue(12);
  fireEvent.change(screen.getByLabelText("结算周期"), { target: { value: "weekly" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存价格" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
  await waitFor(() =>
    expect(http).toHaveBeenCalledWith(
      "/finance/payroll/pricing",
      expect.objectContaining({
        body: expect.objectContaining({
          teacher_id: teacher,
          currency: "USD",
          cycle: "weekly",
          hourly_pay: 12,
        }),
      }),
    ),
  );
});
test("本周使用实际日期过滤和周汇总，导出工作簿携带明细与发放记录", async () => {
  fixture();
  mount();
  await screen.findByText("应计课酬 · USD");
  fireEvent.change(screen.getByLabelText("统计范围"), { target: { value: "this_week" } });
  await waitFor(() =>
    expect(
      http.mock.calls.some(
        ([path]) => path.includes("/payroll/report?") && path.includes("period=weekly"),
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "导出 Excel" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "导出 Excel" }));
  await waitFor(() =>
    expect(exportPayrollWorkbook).toHaveBeenCalledWith(
      expect.stringMatching(/\.xlsx$/),
      expect.objectContaining({
        details: expect.arrayContaining([
          expect.objectContaining({ student_amount: 225, pay_amount: 18 }),
        ]),
      }),
      [],
    ),
  );
});
test("教师只能查看自己的报表，不提供价格设置或发放操作", async () => {
  fixture();
  mount(true);
  await screen.findByText("应计课酬 · USD");
  expect(screen.queryByRole("button", { name: "价格设置" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "登记已发放" })).not.toBeInTheDocument();
  expect(
    http.mock.calls.some(([path]) => path === "/teachers" || path === "/finance/payroll/pricing"),
  ).toBe(false);
});
