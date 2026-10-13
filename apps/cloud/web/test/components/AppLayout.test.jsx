import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "../../src/layout/AppLayout.jsx";
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));
afterEach(cleanup);
test("切换业务页面时回到顶部，不沿用上一页的滚动位置", () => {
  // AppLayout 会渲染 Sidebar 里的 NavList（react-query + useLocation）。
  // 缺 QueryClientProvider 会直接抛 "No QueryClient set"。
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/admin" element={<div>工作页</div>} />
            <Route path="/students" element={<div>学员页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const main = screen.getByRole("main");
  main.scrollTop = 500;
  fireEvent.click(screen.getByRole("link", { name: "学员管理" }));
  expect(screen.getByText("学员页")).toBeInTheDocument();
  expect(main.scrollTop).toBe(0);
});
