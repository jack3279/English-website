import { getToken } from "./auth-store.js";

export function reportClientError(err, extra = {}) {
  const payload = {
    message: err?.message ?? String(err),
    stack: err?.stack,
    url: typeof location !== "undefined" ? location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    ...extra,
  };
  if (typeof fetch === "undefined") return;
  const base = import.meta.env.VITE_API_BASE || "/api";
  const token = getToken();
  fetch(`${base}/client-errors`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
