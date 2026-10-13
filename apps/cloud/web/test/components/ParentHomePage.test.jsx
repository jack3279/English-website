import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ParentHomePage from "../../src/features/parent-h5/ParentHomePage.jsx";
import { http } from "../../src/lib/http.js";

vi.mock("../../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../../src/features/parent-h5/useRealtime.js", () => ({
  useRealtime: () => ({ refetchInterval: false }),
}));
vi.mock("../../src/features/parent-h5/FeedList.jsx", () => ({
  default: () => <div>课堂反馈</div>,
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));

let client;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ParentHomePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

test("孩子资料加载中不能显示未绑定", () => {
  http.mockImplementation((path) =>
    path.startsWith("/students") ? new Promise(() => {}) : Promise.resolve({ data: {} }),
  );
  renderPage();
  expect(screen.queryByText("还没绑定孩子")).not.toBeInTheDocument();
});

test("孩子资料加载失败显示重试入口，不显示未绑定", async () => {
  http.mockImplementation((path) =>
    path.startsWith("/students")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ data: {} }),
  );
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent("孩子资料加载失败");
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  expect(screen.queryByText("还没绑定孩子")).not.toBeInTheDocument();
});

test("孩子列表一次拉取 100 条，多子女家庭不会被默认分页截断", async () => {
  const students = Array.from({ length: 11 }, (_, index) => ({
    id: `s${index + 1}`,
    full_name: `孩子${index + 1}`,
    remaining_hours: 10,
  }));
  http.mockImplementation((path) => {
    if (path === "/students?pageSize=100") return Promise.resolve({ data: students });
    if (path.startsWith("/parent/lessons")) return Promise.resolve({ data: [] });
    if (path.startsWith("/me/renewal")) return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: {} });
  });

  renderPage();

  expect(http).toHaveBeenCalledWith("/students?pageSize=100");
  expect(await screen.findByRole("button", { name: /孩子11/ })).toBeInTheDocument();
});

test("课程查询失败不能显示暂无安排", async () => {
  http.mockImplementation((path) => {
    if (path.startsWith("/students"))
      return Promise.resolve({ data: [{ id: "s1", full_name: "孩子甲" }] });
    if (path.startsWith("/parent/lessons")) return Promise.reject(new Error("offline"));
    return Promise.resolve({ data: {} });
  });
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent("课程加载失败");
  expect(screen.queryByText("暂无安排")).not.toBeInTheDocument();
});

test("切换孩子时仅显示所选孩子的课程", async () => {
  http.mockImplementation((path) => {
    if (path.startsWith("/students"))
      return Promise.resolve({
        data: [
          { id: "s1", full_name: "孩子甲" },
          { id: "s2", full_name: "孩子乙" },
        ],
      });
    if (path.startsWith("/parent/lessons"))
      return Promise.resolve({
        data: [
          {
            id: "l1",
            student_id: "s1",
            scheduled_at: "2026-10-09T08:00:00Z",
            duration_min: 60,
            profiles: { full_name: "Teacher A" },
          },
          {
            id: "l2",
            student_id: "s2",
            scheduled_at: "2026-10-10T08:00:00Z",
            duration_min: 30,
            profiles: { full_name: "Teacher B" },
          },
        ],
      });
    return Promise.resolve({ data: {} });
  });
  renderPage();
  expect(await screen.findByText(/Teacher A · 60 分钟/)).toBeInTheDocument();
  expect(screen.queryByText(/Teacher B · 30 分钟/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /孩子乙/ }));
  expect(await screen.findByText(/Teacher B · 30 分钟/)).toBeInTheDocument();
  expect(screen.queryByText(/Teacher A · 60 分钟/)).not.toBeInTheDocument();
});
