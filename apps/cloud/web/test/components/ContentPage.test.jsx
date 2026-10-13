// /content 的权限口径守卫。
//
// 产品定的是：家长端与教师端的「公告与教材」都是只读视图，
// 发布 / 删除只归管理员。前端不显示按钮只是第一层，后端
// routes/materials.js 也已收窄（见 announcements.test.js）。
// 这里锁住的是「角色 -> 有无写按钮」的映射，防止后来有人
// 为了让老师方便又把按钮加回来。
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ContentPage from "../../src/features/materials/ContentPage.jsx";

const state = vi.hoisted(() => ({ role: "parent" }));

vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { id: "u1", email: "u1@example.com", role: state.role } }),
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/components/PageShell.jsx", () => ({
  PageShell: ({ children }) => <div>{children}</div>,
}));
vi.mock("../../src/lib/http.js", () => ({
  http: vi.fn(async (path) => {
    const p = String(path);
    if (p.startsWith("/announcements")) {
      return {
        data: {
          items: [
            {
              id: "a1",
              title: "中秋放假安排",
              body: "9/15-9/17 停课",
              audience: null,
              pinned: true,
              published_at: "2026-09-10T02:00:00.000Z",
            },
          ],
          total: 1,
        },
      };
    }
    if (p.startsWith("/materials")) {
      return {
        data: {
          items: [
            {
              id: "m1",
              title: "Unit 3 课件",
              description: "请提前打印",
              kind: "link",
              url: "https://example.com/u3",
              student_id: null,
              created_at: "2026-09-09T02:00:00.000Z",
            },
          ],
          total: 1,
        },
      };
    }
    return { data: { items: [{ id: "s1", full_name: "陈小美" }], total: 1 } };
  }),
}));

let client;
function mount(role) {
  state.role = role;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ContentPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function openMaterials() {
  fireEvent.click(await screen.findByText("学习内容"));
  await screen.findByText("Unit 3 课件");
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});

test("家长端公告只读：无发布按钮、无删除按钮", async () => {
  mount("parent");
  await screen.findByText("中秋放假安排");
  expect(screen.queryByRole("button", { name: /发布公告/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除公告" })).not.toBeInTheDocument();
  expect(screen.getByText(/只读视图/)).toBeInTheDocument();
});

test("家长端学习内容只读", async () => {
  mount("parent");
  await openMaterials();
  expect(screen.queryByRole("button", { name: /发布内容/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除教材" })).not.toBeInTheDocument();
});

test("教师端学习内容也是只读（不发教材）", async () => {
  mount("teacher");
  await openMaterials();
  expect(screen.queryByRole("button", { name: /发布内容/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除教材" })).not.toBeInTheDocument();
  expect(screen.getByText(/只读视图/)).toBeInTheDocument();
});

test("教师端公告同样只读", async () => {
  mount("teacher");
  await screen.findByText("中秋放假安排");
  expect(screen.queryByRole("button", { name: /发布公告/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除公告" })).not.toBeInTheDocument();
});

test("管理员保留发布入口", async () => {
  mount("admin");
  await screen.findByText("中秋放假安排");
  expect(screen.getByRole("button", { name: /发布公告/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除公告" })).toBeInTheDocument();
  expect(screen.queryByText(/只读视图/)).not.toBeInTheDocument();
});
