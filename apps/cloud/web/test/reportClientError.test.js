import { test, expect, vi, afterEach } from "vitest";
import { setSession, clearSession } from "../src/lib/auth-store.js";
import { reportClientError } from "../src/lib/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

test("前端错误上报不发送 body userId，只通过 Authorization 携带真实登录态", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { recorded: true } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  setSession({
    access_token: "real-access-token",
    refresh_token: null,
    user: { id: "real-user" },
  });

  reportClientError(new Error("boom"));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/client-errors");
  expect(init.method).toBe("POST");
  expect(init.headers.authorization).toBe("Bearer real-access-token");
  const body = JSON.parse(init.body);
  expect(body.userId).toBeUndefined();
  expect(body.message).toBe("boom");
});
