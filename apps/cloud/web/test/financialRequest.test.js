import { test, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { http } from "../src/lib/http.js";
import { financialRequest } from "../src/lib/financialRequest.js";
vi.mock("../src/lib/http.js", () => ({ http: vi.fn() }));
vi.mock("../src/lib/auth-store.js", () => ({ getUser: () => ({ id: "finance-test" }) }));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  http.mockReset();
});
test("网络失败后沿用提交编号，成功后下一笔生成新编号", async () => {
  const body = { student_id: "s-1", amount_cents: 100 };
  http.mockRejectedValueOnce(new Error("network lost")).mockResolvedValue({ data: { ok: true } });
  await expect(financialRequest("/packages/purchase", body)).rejects.toThrow("network lost");
  await financialRequest("/packages/purchase", body);
  const first = http.mock.calls[0][1].body.idempotency_key;
  expect(http.mock.calls[1][1].body.idempotency_key).toBe(first);
  await financialRequest("/packages/purchase", body);
  expect(http.mock.calls[2][1].body.idempotency_key).not.toBe(first);
});
test("结果未知不能换编号重试，明确校验失败允许修正后重新提交", async () => {
  const body = { student_id: "s-2", amount_cents: 200 };
  http
    .mockRejectedValueOnce(
      Object.assign(new Error("unknown"), { status: 409, code: "FINANCIAL_RESULT_UNKNOWN" }),
    )
    .mockRejectedValueOnce(Object.assign(new Error("bad"), { status: 400, code: "BAD_REQUEST" }))
    .mockResolvedValue({ data: { ok: true } });
  await expect(financialRequest("/packages/purchase", body)).rejects.toThrow();
  await expect(financialRequest("/packages/purchase", body)).rejects.toThrow();
  await financialRequest("/packages/purchase", body);
  expect(http.mock.calls[0][1].body.idempotency_key).toBe(
    http.mock.calls[1][1].body.idempotency_key,
  );
  expect(http.mock.calls[2][1].body.idempotency_key).not.toBe(
    http.mock.calls[1][1].body.idempotency_key,
  );
});
