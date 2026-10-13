import { test, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSchedule } from "../src/features/schedule/useSchedule.js";
import { http } from "../src/lib/http.js";

vi.mock("../src/lib/http.js", () => ({ http: vi.fn() }));

afterEach(() => vi.clearAllMocks());

function renderUseSchedule(options) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useSchedule(options), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

test("enabled=false 时不发起课表查询", () => {
  renderUseSchedule({
    from: "2026-10-01T00:00:00+08:00",
    to: "2026-10-29T00:00:00+08:00",
    enabled: false,
  });
  expect(http).not.toHaveBeenCalled();
});

test("历史课节查询会把状态筛选传给服务端", () => {
  http.mockResolvedValue({ data: [] });
  renderUseSchedule({
    from: "2026-10-01T00:00:00+08:00",
    to: "2026-10-29T00:00:00+08:00",
    statuses: ["completed", "cancelled", "no_show"],
  });
  expect(http).toHaveBeenCalledTimes(1);
  expect(String(http.mock.calls[0][0])).toContain(
    "statuses=completed%2Ccancelled%2Cno_show",
  );
});
