import { test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NavList, getNavigation } from "../../src/layout/Navigation.jsx";
afterEach(cleanup);
function renderNav(role = "admin", path = "/admin") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <NavList role={role} />
    </MemoryRouter>,
  );
}
test("管理员默认只展示日常入口，数据工具可通过三级菜单找到", () => {
  renderNav();
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.queryByRole("link", {name: "今日待办"})).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "数据备份" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "系统管理" }));
  fireEvent.click(screen.getByRole("button", { name: "数据工具" }));
  expect(screen.getByRole("link", { name: "数据备份" })).toHaveAttribute("href", "/admin/backups");
});
test("直接打开深层页面时自动展开所属分类，并标明当前位置", () => {
  renderNav("admin", "/admin/backups");
  expect(screen.getByRole("button", { name: "系统管理" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "数据工具" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "数据备份" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "工作台" })).not.toHaveAttribute("aria-current");
});
test("学员详情仍高亮学员管理，旧课酬地址能正确定位分类", () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/students/student-1"]}>
      <NavList role="admin" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "学员管理" })).toHaveAttribute("aria-current", "page");
  unmount();
  renderNav("admin", "/teacher/payroll");
  expect(screen.getByRole("link", { name: "教师课酬" })).toHaveAttribute("aria-current", "page");
});
test("老师和家长的菜单不出现机构财务和系统管理", () => {
  const { unmount } = render(
    <MemoryRouter>
      <NavList role="teacher" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "我的学生" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "财务管理" })).not.toBeInTheDocument();
  unmount();
  renderNav("parent", "/parent");
  expect(screen.getByRole("link", { name: "孩子课程" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "系统管理" })).not.toBeInTheDocument();
});
test("每个角色的导航没有重复页面入口", () => {
  function links(nodes) {
    return nodes.flatMap((node) => (node.items ? links(node.items) : [node.to]));
  }
  for (const role of ["admin", "teacher", "parent"]) {
    const paths = links(getNavigation(role));
    expect(new Set(paths).size).toBe(paths.length);
  }
});

test("进入另一个工作页面后，已离开的低频分类自动收起", () => {
  renderNav("admin", "/admin/backups");
  fireEvent.click(screen.getByRole("link", { name: "课程表" }));
  expect(screen.getByRole("button", { name: "系统管理" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.queryByRole("link", { name: "数据备份" })).not.toBeInTheDocument();
});
