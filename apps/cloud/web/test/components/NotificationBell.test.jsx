import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell } from "../../src/features/notifications/NotificationBell.jsx";

function makeRes(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(obj),
  };
}

// 铃铛读的是轻量 unread-count（{count}），面板读列表（{items,unread}）。
// 两个接口的返回结构不一样，mock 必须按 URL 分流 —— 用同一个固定返回值的话，
// 铃铛会拿到 undefined 而不渲染角标。
function makeFetch(items, unread) {
  return vi.fn(async (url) =>
    String(url).includes("unread-count")
      ? makeRes({ data: { count: unread } })
      : makeRes({ data: { items, unread } }),
  );
}

const SAMPLE_ITEM = {
  id: "n1",
  type: "renewal",
  title: "课时不足",
  body: "David 只剩 2 小时",
  link: "/admin/finance",
  created_at: new Date().toISOString(),
  read: false,
};

function renderBell(handler) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// vitest 没开 globals, RTL 不会自动清理, 必须手动 cleanup 否则多次渲染叠加
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("未读数显示在角标上", async () => {
  vi.stubGlobal("fetch", makeFetch([SAMPLE_ITEM], 1));
  renderBell();
  await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
});

test("点铃铛展开列表并显示通知标题", async () => {
  vi.stubGlobal("fetch", makeFetch([SAMPLE_ITEM], 1));
  renderBell();
  fireEvent.click(screen.getByLabelText("通知"));
  await waitFor(() => expect(screen.getByText("课时不足")).toBeInTheDocument());
  expect(screen.getByText(/David 只剩 2 小时/)).toBeInTheDocument();
});

test("全部已读会调 POST /notifications/read", async () => {
  const fetchMock = vi.fn(async (url, opts) => {
    if (String(url).includes("/read")) return makeRes({ data: { updated: 1 } });
    return String(url).includes("unread-count")
      ? makeRes({ data: { count: 1 } })
      : makeRes({
          data: {
            items: [
              {
                id: "n1",
                type: "system",
                title: "系统通知",
                body: null,
                link: null,
                created_at: new Date().toISOString(),
                read: false,
              },
            ],
            unread: 1,
          },
        });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderBell();
  fireEvent.click(screen.getByLabelText("通知"));
  // 等数据到位 (按钮在 unread=0 时是 disabled, 直接点会没反应)
  await waitFor(() => expect(screen.getByText("系统通知")).toBeInTheDocument());
  fireEvent.click(screen.getByText("全部已读"));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/notifications/read"))).toBe(
      true,
    ),
  );
});

test("没有通知时显示空态", async () => {
  vi.stubGlobal("fetch", makeFetch([], 0));
  renderBell();
  fireEvent.click(screen.getByLabelText("通知"));
  await waitFor(() => expect(screen.getByText("暂无通知")).toBeInTheDocument());
});
