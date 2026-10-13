import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GenerateModal } from "../../src/features/schedule/SchedulePage.jsx";
import { http } from "../../src/lib/http.js";
vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function renderModal(fail = false) {
  http.mockImplementation((path) => {
    if (path === "/courses") return Promise.resolve({ data: { items: [] } });
    return fail
      ? Promise.reject(new Error("无法生成课程"))
      : Promise.resolve({ data: { created: 2, skipped_existing: 0, skipped_conflict: 0 } });
  });
  const refreshed = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GenerateModal
        anchor={new Date("2026-10-08T00:00:00Z")}
        onClose={vi.fn()}
        onSuccess={refreshed}
      />
    </QueryClientProvider>,
  );
  return refreshed;
}
test("批量生成成功会通知刷新课表，生成结果仍可查看", async () => {
  const refreshed = renderModal();
  fireEvent.click(screen.getByRole("button", { name: "生成", exact: true }));
  await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/新建/)).toHaveTextContent("2");
  expect(screen.getByRole("heading", { name: "按规律课生成课节" })).toBeInTheDocument();
});
test("生成失败时显示错误且不会报告成功刷新", async () => {
  const refreshed = renderModal(true);
  fireEvent.click(screen.getByRole("button", { name: "生成", exact: true }));
  expect(await screen.findByText("无法生成课程")).toBeInTheDocument();
  expect(refreshed).not.toHaveBeenCalled();
});
