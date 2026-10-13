import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LowBalanceWidget } from "../../src/features/admin/AdminDashboardPage.jsx";
import { http } from "../../src/lib/http.js";

vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/features/admin/DashboardCharts.jsx", () => ({ default: () => null }));
vi.mock("../../src/components/PageHeader.jsx", () => ({ PageHeader: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWidget() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <LowBalanceWidget />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

test("无课时学员也进入关注列表且详情链接正确", async () => {
  http.mockResolvedValue({
    data: {
      low_balance: [],
      zero_balance: [{ id: "s1", full_name: "待续费", remaining_hours: 0 }],
    },
  });
  renderWidget();
  expect(await screen.findByRole("link", { name: /待续费/ })).toHaveAttribute(
    "href",
    "/students/s1",
  );
  expect(screen.queryByText("所有学员课时充足")).not.toBeInTheDocument();
});

test("加载失败显示重试入口，不能显示余额充足", async () => {
  http.mockRejectedValue(new Error("offline"));
  renderWidget();
  expect(await screen.findByRole("alert")).toHaveTextContent("课时预警加载失败");
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  expect(screen.queryByText("所有学员课时充足")).not.toBeInTheDocument();
});
