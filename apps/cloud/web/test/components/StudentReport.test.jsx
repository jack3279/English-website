import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentReport } from "../../src/features/students/StudentReport.jsx";

const PAYLOAD = {
  data: {
    range: { from: "2026-08-20", to: "2026-09-19" },
    metrics: {
      planned: 4,
      completed: 2,
      cancelled: 1,
      no_show: 1,
      leave_approved: 1,
      hours: 2,
      attendance_rate: 50,
      remaining_hours: 12.5,
    },
    items: [
      {
        id: "l1",
        scheduled_at: "2026-09-01T10:00:00Z",
        status: "completed",
        duration_min: 60,
        teacher_name: "Alice",
        performance: "excellent",
        homework: null,
      },
      {
        id: "l3",
        scheduled_at: "2026-09-15T10:00:00Z",
        status: "no_show",
        duration_min: 60,
        teacher_name: "Alice",
        performance: null,
        homework: null,
      },
    ],
  },
};

function makeRes(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(obj),
  };
}

function renderReport(handler) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StudentReport studentId="22222222-2222-2222-2222-222222222222" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("渲染学习报告的核心指标", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => makeRes(PAYLOAD)),
  );
  renderReport();
  await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
  expect(screen.getByText("2")).toBeInTheDocument(); // 上课次数
  expect(screen.getByText("2h")).toBeInTheDocument(); // 总课时
  expect(screen.getByText("12.5h")).toBeInTheDocument(); // 剩余课时
  expect(screen.getByText("50%")).toBeInTheDocument(); // 出勤率
  expect(screen.getByText("计划 4 节")).toBeInTheDocument();
  // 两条课节都渲染出来，老师名会出现两次
  expect(screen.getAllByText("Alice")).toHaveLength(2);
  expect(screen.getByText("已完成")).toBeInTheDocument();
  // "缺勤" 既是指标卡标签，也是 no_show 课节的状态文案
  expect(screen.getAllByText("缺勤").length).toBeGreaterThanOrEqual(2);
});

test("切换周期会带上新的日期参数重新取数", async () => {
  const fetchMock = vi.fn(async () => makeRes(PAYLOAD));
  vi.stubGlobal("fetch", fetchMock);
  renderReport();
  await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
  fireEvent.click(screen.getByText("全部"));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => !String(c[0]).includes("from="))).toBe(true),
  );
});
