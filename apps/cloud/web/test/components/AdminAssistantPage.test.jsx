import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminAssistantPage from "../../src/features/admin/AdminAssistantPage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/http.js", () => ({
  http: vi.fn(async () => ({
    data: {
      storageReady: true,
      configured: false,
      enabled: false,
      keyConfigured: false,
      consent: false,
      bound: false,
      budgetYuan: 20,
      dailyLimit: 20,
      history: [],
      usage: {},
    },
  })),
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
test("新配置默认关闭，不自动生成二维码或发送真实测试问题", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminAssistantPage />
    </QueryClientProvider>,
  );
  await screen.findByText("未启用");
  expect(screen.getByRole("button", { name: "生成微信绑定二维码" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "提问" })).toBeDisabled();
  expect(http).toHaveBeenCalledTimes(1);
  expect(http).toHaveBeenCalledWith("/admin-bot/settings");
  expect(screen.getByLabelText("DeepSeek API Key")).toHaveAttribute("type", "password");
  expect(screen.getByLabelText("启用微信机器人")).toBeDisabled();
  expect(screen.getByText(/尚未完成本人微信绑定/)).toBeInTheDocument();
  expect(screen.getByLabelText("课前提醒我联系家长")).not.toBeChecked();
  expect(screen.getByLabelText("提前多少分钟（1–180）")).toHaveValue(30);
});
