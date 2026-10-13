import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserMenu } from "../../src/components/UserMenu.jsx";
const identity = vi.hoisted(() => ({ role: "parent" }));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ user: { role: identity.role, full_name: "测试用户" }, logout: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  identity.role = "parent";
});
test("个人设置与设备入口收进头像菜单，家长不能看到老师课酬", () => {
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: "账号设置" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  expect(screen.getByRole("link", { name: "账号设置" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("link", { name: "登录设备" })).toHaveAttribute("href", "/admin/sessions");
  expect(screen.queryByRole("link", { name: "我的课酬" })).not.toBeInTheDocument();
});
test("老师可以从头像菜单进入自己的课酬", () => {
  identity.role = "teacher";
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  expect(screen.getByRole("link", { name: "我的课酬" })).toHaveAttribute(
    "href",
    "/teacher/payroll",
  );
});
