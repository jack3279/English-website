import { test, expect, vi } from "vitest";
import { recoverChunkOnce } from "../src/lib/chunkRecovery.js";

function runtime() {
  const entries = new Map();
  return {
    sessionStorage: {
      getItem: (key) => entries.get(key),
      setItem: (key, value) => entries.set(key, value),
    },
    location: { reload: vi.fn() },
  };
}

test("持续模块加载失败时，同一版本只自动刷新一次", () => {
  const browser = runtime();
  expect(recoverChunkOnce("build-a", browser)).toBe(true);
  expect(recoverChunkOnce("build-a", browser)).toBe(false);
  expect(browser.location.reload).toHaveBeenCalledTimes(1);
});

test("新版本仍可尝试恢复，旧版本的失败不会阻止新版本加载", () => {
  const browser = runtime();
  recoverChunkOnce("build-a", browser);
  expect(recoverChunkOnce("build-b", browser)).toBe(true);
  expect(browser.location.reload).toHaveBeenCalledTimes(2);
});

test("浏览器禁用存储时不自动刷新，也不抛出异常", () => {
  const browser = runtime();
  browser.sessionStorage.getItem = () => {
    throw new Error("Storage unavailable");
  };
  expect(recoverChunkOnce("build-a", browser)).toBe(false);
  expect(browser.location.reload).not.toHaveBeenCalled();
});
