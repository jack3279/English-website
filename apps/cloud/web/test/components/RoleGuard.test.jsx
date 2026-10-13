import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RoleGuard from "../../src/features/auth/RoleGuard.jsx";
import { setSession, clearSession } from "../../src/lib/auth-store.js";

// ⚠️ 角色必须通过 auth-store.setSession 写入，不能只 localStorage.setItem。
// auth-store 有模块级内存缓存（_memUser / _memToken），模块初始化时读一次后
// 只由 setSession/clearSession 更新 —— 直接写 localStorage 会被缓存挡住，
// RoleGuard 拿到的仍是上一次的登录态，测试结果不可信。
function loginAs(role) {
  setSession({
    access_token: "fake-jwt",
    refresh_token: "fake-refresh",
    user: { id: "u1", email: "u1@test.com", role },
  });
}

afterEach(() => {
  cleanup();
  clearSession();
  localStorage.clear();
});

test("无 token 跳到 /login", () => {
  clearSession();
  render(
    <MemoryRouter initialEntries={["/teacher/today"]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/teacher/today"
          element={
            <RoleGuard roles={["teacher"]}>
              <div>Today</div>
            </RoleGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("Login Page")).toBeInTheDocument();
});

test("有 token 但 role 不匹配 → 跳到 403 页", () => {
  loginAs("parent");
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RoleGuard roles={["admin"]}>
              <div>Admin</div>
            </RoleGuard>
          }
        />
        {/* RoleGuard 角色不匹配时 Navigate 到 /403（不是内联渲染），
            必须注册这条路由，否则查询落在空 Routes 上，报
            "Unable to find an element with the text: /无权/"。 */}
        <Route path="/403" element={<div>无权访问该页面</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText(/无权/)).toBeInTheDocument();
});

test("角色匹配 → 正常渲染内容", () => {
  loginAs("admin");
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RoleGuard roles={["admin"]}>
              <div>Admin</div>
            </RoleGuard>
          }
        />
        <Route path="/403" element={<div>无权访问该页面</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("Admin")).toBeInTheDocument();
});