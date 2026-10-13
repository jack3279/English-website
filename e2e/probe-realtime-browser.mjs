// 权威探测: 在真实 Chromium 里, 以 17say.org 为页面来源, 用三种鉴权连生产 Realtime。
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://17say.org/login", { waitUntil: "domcontentloaded" }); // origin = 17say.org

const results = await page.evaluate(async () => {
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );
  const URL = "https://ueuerggzomryvisijdym.supabase.co";
  const ANON = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

  // 经 Worker 登录拿真实 JWT
  const lr = await fetch("https://api.17say.org/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "lilyparent@17say.org", password: "Demo1234!" }),
  });
  const lj = await lr.json();
  const access = lj.data.access_token;
  const refresh = lj.data.refresh_token;

  function probe(label, setup) {
    return new Promise(async (resolve) => {
      const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      await setup(sb);
      const ch = sb.channel(`browser-probe:${label}:${Date.now()}`);
      let done = false;
      const finish = (status, extra = "") => {
        if (done) return;
        done = true;
        sb.removeChannel(ch).finally(() => resolve({ label, status, extra }));
      };
      ch.on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, () => {});
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED") finish("SUBSCRIBED");
        else if (status === "CHANNEL_ERROR")
          finish("CHANNEL_ERROR", (err?.message || "").slice(0, 100));
        else if (status === "TIMED_OUT") finish("TIMED_OUT");
      });
      setTimeout(() => finish("10s无定论"), 10000);
    });
  }

  const out = [];
  out.push(await probe("1-匿名无会话", async () => {}));
  out.push(await probe("2-setAuth用户JWT", async (sb) => sb.realtime.setAuth(access)));
  out.push(
    await probe("3-setSession原生会话", async (sb) =>
      sb.auth.setSession({ access_token: access, refresh_token: refresh }),
    ),
  );
  return { refreshLen: refresh.length, out };
});

await browser.close();
console.log(`refresh_token 长度: ${results.refreshLen}`);
for (const r of results.out) {
  console.log(`  [${r.label}] -> ${r.status}${r.extra ? "  (" + r.extra + ")" : ""}`);
}
process.exit(0);
