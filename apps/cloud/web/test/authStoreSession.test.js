import { test, expect, afterEach } from "vitest";
import { setSession, clearSession } from "../src/lib/auth-store.js";
afterEach(() => clearSession());
test("新会话未勾选记住设备时，移除上一次会话遗留的刷新令牌", () => {
  setSession({
    access_token: "old-access",
    refresh_token: "old-refresh",
    user: { id: "old-user" },
  });
  expect(localStorage.getItem("cloud_refresh_token")).toBe("old-refresh");
  setSession({ access_token: "new-access", refresh_token: null, user: { id: "new-user" } });
  expect(localStorage.getItem("cloud_refresh_token")).toBeNull();
  expect(localStorage.getItem("cloud_jwt")).toBe("new-access");
});
