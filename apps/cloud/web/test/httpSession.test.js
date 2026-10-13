import { test, expect, vi, afterEach } from "vitest";
const session = vi.hoisted(() => ({ token: "expired", refresh: null }));
vi.mock("../src/lib/auth-store.js", () => ({
  getToken: () => session.token,
  getUser: () => null,
  getRefreshToken: () => session.refresh,
  setAccessToken: vi.fn(),
  clearSession: vi.fn(() => {
    session.token = null;
    session.refresh = null;
  }),
}));
import { http } from "../src/lib/http.js";
import { clearSession } from "../src/lib/auth-store.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  session.token = "expired";
  session.refresh = null;
});
function reply(status) {
  return new Response(JSON.stringify({ error: "request failed" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
test("无刷新令牌的过期会话会清除登录态，让设置页重新登录", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401)));
  await expect(http("/institution-settings")).rejects.toMatchObject({ status: 401 });
  expect(clearSession).toHaveBeenCalledTimes(1);
});
test("网络或服务端暂时失败不会把用户退出登录", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(503)));
  await expect(http("/institution-settings")).rejects.toMatchObject({ status: 503 });
  expect(clearSession).not.toHaveBeenCalled();
});
test("登录密码错误不会清除其他已存在的会话", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(401)));
  await expect(http("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
    status: 401,
  });
  expect(clearSession).not.toHaveBeenCalled();
});
