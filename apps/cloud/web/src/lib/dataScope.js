import { getUser } from "./auth-store.js";
export function getDataScope() {
  const user = getUser();
  if (user?.is_test_account) return "test";
  if (user?.role !== "admin") return "production";
  try {
    return localStorage.getItem("data-scope:" + user.id) === "test" ? "test" : "production";
  } catch {
    return "production";
  }
}
export function setDataScope(mode) {
  const user = getUser();
  if (!user || user.is_test_account || user.role !== "admin") return;
  localStorage.setItem("data-scope:" + user.id, mode === "test" ? "test" : "production");
  window.location.reload();
}
