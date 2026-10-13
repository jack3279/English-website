import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminMobileHome from "../../src/features/admin/AdminMobileHome.jsx";
import AllFeaturesPage from "../../src/features/admin/AllFeaturesPage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/useMobile.js", () => ({ useMobile: () => true }));
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function mount(component) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{component}</QueryClientProvider>
    </MemoryRouter>,
  );
}
test("管理员手机首页使用真实统计，零项待办不占卡片", async () => {
  http.mockImplementation(async (path) => ({
    data:
      path === "/finance/summary"
        ? { total: { active_students: 26 }, this_month: { revenue_cents: 123450 } }
        : path === "/alerts"
          ? { zero_balance: [{}], low_balance: [{}] }
          : [{ id: "lesson-a", status: "scheduled", scheduled_at: "2026-10-10T08:00:00Z", duration_min: 60 }, { id: "lesson-b", status: "cancelled", scheduled_at: "2026-10-10T09:00:00Z", duration_min: 60 }],
  }));
  mount(
    <AdminMobileHome
      me={{ full_name: "教务" }}
      ops={{
        summary: { total: 3 },
        groups: [
          { key: "leave", count: 3, title: "请假审批", link: "/leave" },
          { key: "lead", count: 0, title: "新线索未跟进", link: "/admin/leads" },
        ],
      }}
    />,
  );
  expect(await screen.findByText("26")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /全部 3 项/ })).toHaveAttribute(
    "href",
    "/admin/operations",
  );
  expect(screen.getByRole("link", { name: /请假审批/ })).toHaveAttribute("href", "/leave");
  expect(screen.queryByText("新线索未跟进")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "全部功能" })).toHaveAttribute("href", "/admin/features");
});
test("读取待办失败不能显示已处理完，提供重试", async () => {
  http.mockRejectedValue(new Error("offline"));
  const retry = vi.fn();
  mount(<AdminMobileHome opsError retryOps={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("待办加载失败");
  expect(screen.queryByText("暂无待处理事项")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(retry).toHaveBeenCalledOnce();
});
test("全部功能分类可找到深层数据工具，入口使用现有业务页面", () => {
  mount(<AllFeaturesPage />);
  expect(screen.getByRole("link", { name: "教师档案" })).toHaveAttribute("href", "/admin/teachers");
  fireEvent.click(screen.getByText("数据工具"));
  expect(screen.getByRole("link", { name: "数据备份" })).toHaveAttribute("href", "/admin/backups");
  expect(screen.getByRole("link", { name: "机构设置" })).toHaveAttribute(
    "href",
    "/admin/institution-settings",
  );
});
