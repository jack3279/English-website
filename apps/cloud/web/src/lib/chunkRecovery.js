const RELOAD_KEY = "chunk_reload_at";

export function recoverChunkOnce(buildId, runtime = window) {
  try {
    if (runtime.sessionStorage.getItem(RELOAD_KEY) === buildId) return false;
    runtime.sessionStorage.setItem(RELOAD_KEY, buildId);
  } catch {
    // 无法记录次数时，由页面提供手动重试，避免无限刷新。
    return false;
  }
  runtime.location.reload();
  return true;
}
