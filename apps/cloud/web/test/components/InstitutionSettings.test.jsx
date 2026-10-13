import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InstitutionSettingsPage from "../../src/features/admin/InstitutionSettingsPage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title, actions }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/features/admin/InstitutionContext.jsx", () => {
  const defaults = {
    institutionName: "教学管理",
    defaultDurationMin: 60,
    lowBalanceHours: 3,
    expiryWarnDays: 30,
    leaveDeadlineHours: 0,
    absenceDeductHours: false,
    renewalPercent: 20,
    renewalMinHours: 2,
    loadLimits: { dailyHours: 6, weeklyHours: 25, consecutiveLessons: 3, breakMinutes: 15 },
  };
  return {
    DEFAULT_INSTITUTION: defaults,
    useInstitution: () => ({
      rules: {
        ...defaults,
        storageReady: true,
        timezone: "Asia/Shanghai",
        billingMinutesPerHour: 60,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  };
});
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn(async () => ({ data: {} })) }));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
test("保存只提交可编辑规则，不夹带单位和存储状态", async () => {
  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <InstitutionSettingsPage />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("新课程默认时长（分钟）"), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(http).toHaveBeenCalled());
  const body = http.mock.calls[0][1].body;
  expect(body.defaultDurationMin).toBe(45);
  expect(body.billingMinutesPerHour).toBeUndefined();
  expect(body.storageReady).toBeUndefined();
});

test("缺席默认扣课开关提交布尔值，不影响已有其他设置", async () => {
  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <InstitutionSettingsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /缺勤扣学生课时/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(http).toHaveBeenCalled());
  expect(http.mock.calls[0][1].body.absenceDeductHours).toBe(true);
  expect(http.mock.calls[0][1].body.leaveDeadlineHours).toBe(0);
});

test('请假截止按分钟填写，保存时兼容现有小时字段且不丢失一分钟精度', async () => {
  client = new QueryClient();
  render(<QueryClientProvider client={client}><InstitutionSettingsPage /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('请假最晚提前（分钟）'), { target: { value: '241' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(http).toHaveBeenCalled());
  expect(Math.round(http.mock.calls[0][1].body.leaveDeadlineHours * 60)).toBe(241);
});
