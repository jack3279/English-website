import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateNotificationDialog } from "../../src/features/admin/NotificationsPage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
test("按姓名选择家长，发送失败保留内容并显示错误", async () => {
  http.mockImplementation(async (path, options) => {
    if (options?.method) throw new Error("发送服务暂不可用");
    return {
      data: {
        items: [
          {
            id: "parent-1",
            name: "Lily 妈妈",
            role: "parent",
            email: "parent@example.com",
            phone: "13800000000",
          },
        ],
      },
    };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const success = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CreateNotificationDialog onClose={vi.fn()} onSuccess={success} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("标题 *"), { target: { value: "上课通知" } });
  fireEvent.click(screen.getByLabelText("指定用户"));
  await screen.findByRole("option", { name: /Lily 妈妈/ });
  fireEvent.change(screen.getByLabelText("搜索接收人"), { target: { value: "13800000000" } });
  expect(screen.getByRole("option", { name: /Lily 妈妈/ })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("选择接收人"), { target: { value: "parent-1" } });
  fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("发送服务暂不可用"));
  expect(http).toHaveBeenCalledWith("/notifications", {
    method: "POST",
    body: {
      type: "system",
      title: "上课通知",
      body: null,
      link: null,
      target_user: "parent-1",
      target_role: null,
    },
  });
  expect(success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("标题 *")).toHaveValue("上课通知");
  expect(screen.queryByPlaceholderText(/UUID/)).not.toBeInTheDocument();
});
