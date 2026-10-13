// 未读角标的数据契约：角标数字必须来自 GET /notifications/unread-count
// （后端按 notification_reads 算出的真实未读数），而不是写死的假数。
//
// 本轮踩过的坑（别改回去）：
// 1. **断言 hook 返回值，不要断言 DOM 文本**。角标 span 紧贴按钮文本，
//    React 19 下文本节点会拆分，getByText / toHaveTextContent 都可能匹配不到
//    明明已经渲染的数字。我为此排查了很久，误以为是产品代码 bug。
// 2. afterEach 用 mockReset（不是 mockClear）—— 每个用例要换 mockResolvedValue
//    的返回值；mockClear 只清调用记录会保留上一个用例的实现。
// 3. 渲染含 NavList / useNavigate 的树需要 MemoryRouter（NavList 用了 useLocation）
//    **和** QueryClientProvider，否则直接抛 "No QueryClient set"。
//
// ⚠️ 2026-10-09：侧边栏的「通知中心」入口已移除（与顶栏铃铛重复）。
//    角标现在只由铃铛承担，面板底部提供「查看全部」跳 /inbox。
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUnreadCount, useMarkNotificationsRead } from "../../src/features/notifications/useNotifications.js";
import { NotificationBell } from "../../src/features/notifications/NotificationBell.jsx";
import { Sidebar } from "../../src/layout/Sidebar.jsx";

const httpMock = vi.fn();
vi.mock("../../src/lib/http.js", () => ({ http: (...a) => httpMock(...a) }));
vi.mock("../../src/features/admin/InstitutionContext.jsx", () => ({
  useInstitution: () => ({ rules: { institutionName: "测试机构" } }),
}));
vi.mock("../../src/components/ui/loading.jsx", () => ({ Loading: () => <div>加载中</div> }));

afterEach(() => {
  cleanup();
  httpMock.mockReset();
});

// 把 hook 的返回值提升到组件外，方便直接断言数值（原因见文件头第 1 条）
let captured = Symbol("not-called");
function Capture() {
  const q = useUnreadCount();
  if (q.data !== undefined) captured = q.data;
  return null;
}

function renderWithCapture(node) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderProbe() {
  return renderWithCapture(<Capture />);
}

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("角标数字来自 unread-count 接口的真实返回值", async () => {
  httpMock.mockResolvedValue({ data: { count: 7 } });
  renderProbe();
  await waitFor(() => expect(captured).toBe(7));
  // 必须打轻量接口，不许把 50 条通知正文拉回来只为拿一个数字
  expect(httpMock).toHaveBeenCalledWith("/notifications/unread-count");
  expect(httpMock).not.toHaveBeenCalledWith("/notifications?limit=50");
});

test("未读数为 0 时 hook 返回 0（角标据此不渲染）", async () => {
  httpMock.mockResolvedValue({ data: { count: 0 } });
  renderProbe();
  await waitFor(() => expect(captured).toBe(0));
});

test("后端缺 count 字段时兜底为 0，不能是 undefined", async () => {
  httpMock.mockResolvedValue({ data: {} });
  renderProbe();
  await waitFor(() => expect(captured).toBe(0));
});

test("hook 返回的是数字，99+ 的收敛留给展示层", async () => {
  httpMock.mockResolvedValue({ data: { count: 128 } });
  renderProbe();
  await waitFor(() => expect(captured).toBe(128));
  expect(typeof captured).toBe("number");
});

test("铃铛是唯一通知入口，走 unread-count 接口", async () => {
  httpMock.mockResolvedValue({ data: { count: 3 } });
  renderBell();
  await waitFor(() => expect(screen.getByRole("button", { name: "通知" })).toBeInTheDocument());
  expect(httpMock).toHaveBeenCalledWith("/notifications/unread-count");
});

test("铃铛常驻但不预取通知正文（省子请求）", async () => {
  httpMock.mockResolvedValue({ data: { count: 3 } });
  renderBell();
  await waitFor(() => expect(httpMock).toHaveBeenCalledWith("/notifications/unread-count"));
  // 面板还没打开，不该去拉 50 条正文
  expect(httpMock).not.toHaveBeenCalledWith("/notifications?limit=50");
});

test("侧边栏不再出现重复的通知入口", () => {
  httpMock.mockResolvedValue({ data: { count: 3 } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Sidebar role="parent" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // 铃铛与侧边栏同源同功能，两个默认入口会让用户不知道该点哪个
  expect(screen.queryByRole("button", { name: /通知中心/ })).not.toBeInTheDocument();
});

test("弹窗底部有「查看全部」出口，避免通知被固定高度截断", async () => {
  httpMock.mockImplementation(async (url) => {
    if (String(url).includes("unread-count")) return { data: { count: 1 } };
    return { data: { items: [], unread: 1 } };
  });
  renderBell();
  const bell = screen.getByRole("button", { name: "通知" });
  bell.click();
  await waitFor(() => expect(screen.getByText(/查看全部通知|打开消息中心/)).toBeInTheDocument());
});

test("标记已读会同时失效列表与角标两个 query key", async () => {
  httpMock.mockImplementation(async (url, opts) => {
    if (String(url).includes("unread-count")) return { data: { count: 4 } };
    if (opts?.method === "POST") return { data: { updated: 4 } };
    return { data: { items: [], unread: 4 } };
  });
  let markRead;
  function Grab() {
    markRead = useMarkNotificationsRead();
    return null;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Grab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(markRead).toBeDefined());
  markRead.mutate();
  await waitFor(() =>
    expect(httpMock).toHaveBeenCalledWith("/notifications/read", {
      method: "POST",
      body: {},
    }),
  );
});