import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PayrollPage from "../../src/features/admin/PayrollPage.jsx";
const identity = vi.hoisted(() => ({ role: "teacher" }));
const panel = vi.hoisted(() => vi.fn());
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: identity.role } }),
}));
vi.mock("../../src/components/PageHeader.jsx", () => ({
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));
vi.mock("../../src/features/admin/PayrollPanel.jsx", () => ({
  PayrollPanel: (props) => {
    panel(props);
    return <div>课酬结算与单价编辑</div>;
  },
}));
afterEach(() => {
  cleanup();
  identity.role = "teacher";
  panel.mockClear();
});
test("老师的旧课酬入口仍回到自己的课酬，不挂载机构结算表单", () => {
  render(
    <MemoryRouter initialEntries={["/admin/payroll"]}>
      <Routes>
        <Route path="/admin/payroll" element={<PayrollPage />} />
        <Route path="/teacher/payroll" element={<div>我的课酬</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("我的课酬")).toBeInTheDocument();
  expect(panel).not.toHaveBeenCalled();
});
test("管理员独立课酬页面保留结算和单价编辑功能", () => {
  identity.role = "admin";
  render(
    <MemoryRouter>
      <PayrollPage />
    </MemoryRouter>,
  );
  expect(screen.getByText("课酬结算与单价编辑")).toBeInTheDocument();
  expect(panel).toHaveBeenCalledWith({ showTitle: false });
});
