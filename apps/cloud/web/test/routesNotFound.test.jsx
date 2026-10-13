import { test, expect } from "vitest";
import { Suspense } from "react";
import { router } from "../src/app/routes.jsx";

test("未知路径的懒加载 404 页面必须包在 Suspense 中，直接刷新不白屏", () => {
  const root = router.routes[0];
  const wildcard = root.children.find((route) => route.path === "*");

  expect(wildcard).toBeDefined();
  expect(wildcard.element.type).toBe(Suspense);
  expect(wildcard.element.props.fallback).toBeDefined();
  expect(wildcard.element.props.children).toBeDefined();
});
