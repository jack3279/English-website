import { useState } from "react";
import { test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileSidebar } from "../../src/layout/Sidebar.jsx";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

// 侧边栏 NavList 用 react-query（InstitutionContext）。
// 渲染 MobileSidebar 就必须有 QueryClientProvider,否则直接抛
// "No QueryClient set" —— 这是真实回归，不是测试写坏了。
function Wrapper({ children }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function Harness({ role = "parent" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开菜单</button>
      <MobileSidebar role={role} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

test("打开菜单后聚焦关闭按钮，Escape 关闭并恢复焦点和滚动状态", () => {
  document.body.style.overflow = "scroll";
  render(
    <Wrapper>
      <Harness />
    </Wrapper>,
  );
  const trigger = screen.getByText("打开菜单");
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: "关闭菜单" })).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("scroll");
});

test("Tab 和 Shift+Tab 不能离开打开的导航菜单", () => {
  render(
    <Wrapper>
      <Harness />
    </Wrapper>,
  );
  fireEvent.click(screen.getByText("打开菜单"));
  const close = screen.getByRole("button", { name: "关闭菜单" });
  const last = screen.getByRole("link", { name: "公告与教材" });
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(close).toHaveFocus();
});

test("移动菜单展开分类不会关闭抽屉，进入具体页面才会关闭", () => {
  render(
    <Wrapper>
      <Harness role="admin" />
    </Wrapper>,
  );
  fireEvent.click(screen.getByText("打开菜单"));
  fireEvent.click(screen.getByRole("button", { name: "系统管理" }));
  fireEvent.click(screen.getByRole("button", { name: "数据工具" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "数据备份" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
