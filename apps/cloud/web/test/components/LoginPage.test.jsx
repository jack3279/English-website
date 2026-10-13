import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../../src/features/auth/LoginPage.jsx";

const { login } = vi.hoisted(() => ({ login: vi.fn().mockResolvedValue({}) }));
vi.mock("../../src/features/auth/useAuth.js", () => ({
  useAuth: () => ({ login }),
  fetchMe: vi.fn().mockResolvedValue({ role: "admin" }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

test("点击记住设备的文字后，登录不会要求持久保存会话", async () => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("记住此设备 (30 天内自动登录)"));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "登录", exact: true }));
  await waitFor(() =>
    expect(login).toHaveBeenCalledWith("test@example.com", "test-password", false),
  );
});

test("显示密码按钮保持输入内容且不会提交登录", () => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  const password = screen.getByLabelText("密码");
  fireEvent.change(password, { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
  expect(password).toHaveAttribute("type", "text");
  expect(password).toHaveValue("test-password");
  fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
  expect(password).toHaveAttribute("type", "password");
  expect(login).not.toHaveBeenCalled();
});
