import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StudentsPage from "../../src/features/students/StudentsPage.jsx";
import { exportRowsToXlsx } from "../../src/lib/xlsx.js";

const state = vi.hoisted(() => ({ role: "admin" }));

// 17 行：前 14 在读，15 休学，16 结课，17 停课（保持历史用例「停课 1」可用）。
const rows = Array.from({ length: 17 }, (_, i) => {
  const status = i === 14 ? "leave" : i === 15 ? "graduated" : i === 16 ? "inactive" : "active";
  return { id: `s${i + 1}`, full_name: `学生${i + 1}`, status, remaining_hours: 10 };
});

vi.mock("../../src/features/students/useStudent.js", () => ({
  useStudent: (id) => ({ data: id ? { id, full_name: "预览档案", remaining_hours: 10, packages: [] } : null, isLoading: false }),
  useStudents: () => ({ data: rows, isLoading: false }),
  useStudentStatusCounts: () => ({
    data: { all: 17, active: 14, inactive: 1, leave: 1, graduated: 1, refunded: 0 },
  }),
}));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: state.role } }),
}));
// 删除弹窗在本文件单独测过，这里桩掉，避免它内部发起 HTTP。
vi.mock("../../src/features/students/DeleteStudentDialog.jsx", () => ({
  default: () => <div role="dialog" aria-label="永久删除学员弹窗">删除弹窗</div>,
}));
vi.mock("../../src/components/ui/toast.jsx", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title, actions }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
vi.mock("../../src/lib/xlsx.js", () => ({
  exportRowsToXlsx: vi.fn().mockResolvedValue(undefined),
}));
let client;
afterEach(() => {
  cleanup();
  client?.clear();
  state.role = "admin";
  vi.clearAllMocks();
});
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StudentsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
test("翻页和筛选组合使用时，不遗漏记录或留在空白页", async () => {
  renderPage();
  expect(screen.getByRole("link", { name: "学生1", exact: true })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "学生16", exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByRole("link", { name: "学生16", exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /停课 1/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled());
  expect(screen.getByRole("link", { name: "学生17", exact: true })).toBeInTheDocument();
});
test("导出仍包含全部筛选结果，而非只导出当前页", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 Excel" }));
  await waitFor(() => expect(exportRowsToXlsx).toHaveBeenCalled());
  expect(exportRowsToXlsx.mock.calls[0][2]).toHaveLength(17);
});

test("预览学员不离开列表，完整档案仍可直接打开", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "预览学生1" }));
  expect(await screen.findByText("预览档案")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看完整档案" })).toHaveAttribute("href", "/students/s1");
});

test("状态分段显示全部与五个状态及各自计数", () => {
  renderPage();
  expect(screen.getByRole("button", { name: "全部 17" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /在读 14/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /停课 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /休学 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /结课 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /退费 0/ })).toBeInTheDocument();
});

test("导出的状态列为中文文案（休学/结课等）", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "导出 Excel" }));
  await waitFor(() => expect(exportRowsToXlsx).toHaveBeenCalled());
  const statusFn = exportRowsToXlsx.mock.calls[0][3]["状态"];
  expect(statusFn(rows[0])).toBe("在读");
  expect(statusFn(rows[14])).toBe("休学");
  expect(statusFn(rows[15])).toBe("结课");
  expect(statusFn(rows[16])).toBe("停课");
});

test("admin 编辑弹窗里有「设为停课」和「永久删除」入口", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "编辑学生1" }));
  expect(await screen.findByRole("button", { name: "设为停课" })).toBeInTheDocument();
  const purge = screen.getByRole("button", { name: /永久删除/ });
  expect(purge).toBeInTheDocument();
  // 点击后关闭编辑弹窗并打开独立的删除弹窗
  fireEvent.click(purge);
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "永久删除学员弹窗" })).toBeInTheDocument(),
  );
});

test("非 admin 编辑弹窗不显示停课与永久删除入口", async () => {
  state.role = "teacher";
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "编辑学生1" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "设为停课" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /永久删除/ })).not.toBeInTheDocument();
});
