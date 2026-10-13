import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeaveMakeupPage from "../../src/features/leave/LeaveMakeupPage.jsx";
import { setSession, clearSession } from "../../src/lib/auth-store.js";

const LR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LEAVE_PAYLOAD = {
  data: {
    items: [
      {
        id: LR,
        student_id: "s1",
        lesson_id: "l1",
        status: "pending",
        reason: "发烧",
        requested_by: "p1",
        reviewed_at: null,
        review_note: null,
        student_name: "小明",
        requester_name: "张妈妈",
        lesson: {
          id: "l1",
          scheduled_at: "2026-09-20T10:00:00Z",
          duration_min: 60,
          status: "scheduled",
        },
      },
    ],
    total: 1,
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

function renderPage(role) {
  // ⚠️ 必须走 auth-store 的 setSession，不能只写 localStorage：
  // auth-store 有模块级内存缓存（_memUser），模块初始化时只读一次，
  // 之后只由 setSession/clearSession 更新。直接 localStorage.setItem
  // 会被缓存挡住 → useAuth 仍拿到旧角色 → 家长视角测出管理员界面。
  setSession({
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    user: { id: "u1", email: "u1@test.com", role },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // 页面里用了 Link / useNavigate，必须包 MemoryRouter，
  // 否则报 "Cannot destructure property 'basename' of useContext(...)"。
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeaveMakeupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
  localStorage.clear();
});

test("管理员看到待审批请假单并可批准", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/leave")) return makeRes(LEAVE_PAYLOAD);
    return makeRes({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage("admin");

  await waitFor(() => expect(screen.getByText("小明")).toBeInTheDocument());
  // "待审批" 同时出现在筛选按钮与状态徽章上
  expect(screen.getAllByText("待审批").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/发烧/)).toBeInTheDocument();

  fireEvent.click(screen.getByText("审批"));
  fireEvent.click(screen.getByText("批准"));

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        (c) => c[0].includes(`/leave/${LR}/review`) && c[1]?.method === "POST",
      ),
    ).toBe(true),
  );
  const call = fetchMock.mock.calls.find((c) => c[0].includes("/review"));
  expect(JSON.parse(call[1].body).status).toBe("approved");
});

test("家长视角看不到审批按钮", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/leave")) return makeRes(LEAVE_PAYLOAD);
    if (String(url).includes("/parent/lessons/upcoming")) return makeRes({ data: [] });
    return makeRes({ data: [{ id: "s1", full_name: "小明" }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage("parent");

  await waitFor(() => expect(screen.getByText("小明")).toBeInTheDocument());
  expect(screen.queryByText("审批")).toBeNull();
  expect(screen.getByText("提交请假")).toBeInTheDocument();
});
