import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MoreActions } from "../../src/components/MoreActions.jsx";
afterEach(cleanup);
test("低频操作通过更多入口使用，选择后只执行一次并关闭", () => {
  const onSelect = vi.fn();
  render(<MoreActions actions={[{ label: "导出", onSelect }]} />);
  expect(screen.queryByRole("button", { name: "导出", exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  const action = screen.getByRole("button", { name: "导出", exact: true });
  expect(action).toHaveFocus();
  fireEvent.mouseDown(action);
  fireEvent.click(action);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
});
test("禁用操作不会执行，Escape 可返回触发按钮", () => {
  const onSelect = vi.fn();
  render(<MoreActions actions={[{ label: "导出", disabled: true, onSelect }]} />);
  const trigger = screen.getByRole("button", { name: "更多操作" });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "导出", exact: true }));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
