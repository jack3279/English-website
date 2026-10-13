import { http } from "./http.js";
import { getUser } from "./auth-store.js";
const memory = new Map();
export async function financialRequest(path, body) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(body)),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const storageKey = `financial-attempt-v1:${getUser()?.id || "unknown"}:${path}:${hash}`;
  let key = memory.get(storageKey);
  try {
    key = key || sessionStorage.getItem(storageKey);
  } catch {
    /* unavailable storage */
  }
  if (!key) {
    key = crypto.randomUUID();
    memory.set(storageKey, key);
    try {
      sessionStorage.setItem(storageKey, key);
    } catch {
      /* memory fallback */
    }
  }
  function clear() {
    memory.delete(storageKey);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* memory fallback */
    }
  }
  try {
    const response = await http(path, { method: "POST", body: { ...body, idempotency_key: key } });
    clear();
    return response;
  } catch (error) {
    if (
      error.status >= 400 &&
      error.status < 500 &&
      !["FINANCIAL_RESULT_UNKNOWN", "FINANCIAL_REQUEST_CHANGED"].includes(error.code)
    )
      clear();
    throw error;
  }
}
