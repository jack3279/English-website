import { test, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../src/components/ui/table.jsx";
afterEach(cleanup);

test("移动列表的字段名称与表头一致，合并单元格不会错标金额", () => {
  render(
    <Table aria-label="课酬汇总">
      <TableHeader>
        <TableRow>
          <TableHead>教师</TableHead>
          <TableHead>月份</TableHead>
          <TableHead>课次</TableHead>
          <TableHead>金额</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Alice</TableCell>
          <TableCell>2026-10</TableCell>
          <TableCell>3</TableCell>
          <TableCell>600</TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={2}>合计</TableCell>
          <TableCell>3</TableCell>
          <TableCell>600</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
  const rows = screen.getAllByRole("row");
  expect(
    within(rows[1])
      .getAllByRole("cell")
      .map((c) => c.dataset.label),
  ).toEqual(["教师", "月份", "课次", "金额"]);
  expect(
    within(rows[2])
      .getAllByRole("cell")
      .map((c) => c.dataset.label),
  ).toEqual([undefined, "课次", "金额"]);
  expect(screen.getByRole("columnheader", { name: "金额" })).toHaveAttribute("scope", "col");
});

test("表头变化后，移动字段名称也随之更新", () => {
  const content = (label) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>200</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
  const { rerender } = render(content("课时"));
  expect(screen.getByRole("cell")).toHaveAttribute("data-label", "课时");
  rerender(content("课酬"));
  expect(screen.getByRole("cell")).toHaveAttribute("data-label", "课酬");
});
