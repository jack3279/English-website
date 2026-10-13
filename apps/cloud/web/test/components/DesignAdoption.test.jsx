import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import InboxPage from "../../src/features/notifications/InboxPage.jsx";
import LeadsPage from "../../src/features/admin/LeadsPage.jsx";
import SettingsPage from "../../src/features/admin/SettingsPage.jsx";
import { PayrollPanel } from "../../src/features/admin/PayrollPanel.jsx";
import { MobileBottomNav } from "../../src/layout/MobileBottomNav.jsx";
import { useTheme } from "../../src/hooks/useTheme.js";
import { http } from "../../src/lib/http.js";
const identity = vi.hoisted(() => ({ role: "parent" }));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: identity.role } }),
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
let client;
function mount(component) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
  identity.role = "parent";
  localStorage.removeItem("v2_theme");
  document.documentElement.classList.remove("dark");
});
test("通知按类别与未读组合筛选，空筛选不误报没有历史消息", async () => {
  http.mockResolvedValue({
    data: {
      unread: 1,
      items: [
        {
          id: "a",
          type: "class_report",
          title: "已读反馈",
          read: true,
          created_at: new Date().toISOString(),
        },
        {
          id: "b",
          type: "leave",
          title: "待看请假",
          read: false,
          created_at: new Date().toISOString(),
        },
      ],
    },
  });
  mount(<InboxPage />);
  await screen.findByText("已读反馈");
  fireEvent.click(screen.getByRole("button", { name: "课程" }));
  expect(screen.queryByText("待看请假")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("只看未读"));
  expect(screen.getByText("当前筛选下没有消息")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "教务" }));
  expect(screen.getByText("待看请假")).toBeInTheDocument();
});
test("招生切换分类后总数和其他状态数保持全量口径", async () => {
  http.mockResolvedValue({
    data: [
      { id: "a", parent_name: "甲家长", status: "new" },
      { id: "b", parent_name: "乙家长", status: "contacted" },
      { id: "c", parent_name: "丙家长", status: "converted" },
    ],
  });
  mount(<LeadsPage />);
  await screen.findByText("甲家长");
  fireEvent.click(screen.getByRole("button", { name: "已联系 1" }));
  expect(screen.queryByText("甲家长")).not.toBeInTheDocument();
  expect(screen.getByText("乙家长")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "全部 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已成交 1" })).toBeInTheDocument();
  expect(screen.getByText("成交占比 33.3%")).toBeInTheDocument();
});
test("设置页仅管理员有微信助手入口，家长保留通知与主题", async () => {
  http.mockResolvedValue({ data: { role: "parent", full_name: "家长" } });
  mount(<SettingsPage />);
  await screen.findByText("显示与提醒");
  expect(screen.getByRole("link", { name: /查看课程与教务通知/ })).toHaveAttribute(
    "href",
    "/inbox",
  );
  expect(screen.queryByRole("link", { name: /管理员微信助手/ })).not.toBeInTheDocument();
});
test("手机未读角标复用计数接口并限制显示为99+", async () => {
  http.mockResolvedValue({ data: { count: 128 } });
  mount(<MobileBottomNav role="parent" />);
  expect(await screen.findByLabelText("128条未读通知")).toHaveTextContent("99+");
  expect(http).toHaveBeenCalledWith("/notifications/unread-count");
});
test("课酬同时有PHP和USD时只显示各币种合计", async () => {
  http.mockResolvedValue({
    data: {
      rows: [
        {
          teacher_id: "a",
          teacher_name: "甲老师",
          month: "2026-10-01",
          pay_amount: 100,
          pay_currency: "PHP",
        },
        {
          teacher_id: "b",
          teacher_name: "乙老师",
          month: "2026-10-01",
          pay_amount: 200,
          pay_currency: "USD",
        },
      ],
      totals: { by_currency: { PHP: 100, USD: 200 }, lessons_done: 2, hours: 2 },
      rates: [],
    },
  });
  mount(<PayrollPanel />);
  await screen.findByText("应计课酬 · PHP");
  expect(screen.getByText("应计课酬 · USD")).toBeInTheDocument();
  expect(screen.queryByText("300.00")).not.toBeInTheDocument();
  expect(screen.getByText(/本页应计金额不代表已发放/)).toBeInTheDocument();
});
test("同页面两处主题开关同步，避免设置页与顶栏状态相反", () => {
  localStorage.setItem("v2_theme", "light");
  function Toggle({ id }) {
    const { isDark, toggle } = useTheme();
    return (
      <button onClick={toggle}>
        {id}:{isDark ? "深色" : "浅色"}
      </button>
    );
  }
  render(
    <>
      <Toggle id="顶栏" />
      <Toggle id="设置" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "设置:浅色" }));
  expect(screen.getByRole("button", { name: "顶栏:深色" })).toBeInTheDocument();
  expect(document.documentElement).toHaveClass("dark");
});
