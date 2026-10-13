// 只读实证: 三种鉴权方式连生产 Realtime, 看能否建立 socket / SUBSCRIBED。
// 只订阅、不写任何数据。注意: 即使 SUBSCRIBED, 事件是否下发还取决于 publication+RLS(另测)。
import { createClient } from "@supabase/supabase-js";

const URL = "https://ueuerggzomryvisijdym.supabase.co";
const ANON = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

// 1) 先经 Worker 登录拿到真正的 Supabase access_token
const loginRes = await fetch("https://api.17say.org/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://17say.org" },
  body: JSON.stringify({ email: "lilyparent@17say.org", password: "Demo1234!" }),
});
const loginJ = await loginRes.json();
const access = loginJ.data.access_token;
const refresh = loginJ.data.refresh_token;
console.log("Worker 登录拿到真实 Supabase JWT:", access ? "是" : "否", `| refresh 长度=${refresh?.length}`);

function probe(label, build) {
  return new Promise(async (resolve) => {
    const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await build(sb);
    const channel = sb.channel(`probe:${label}:${Date.now()}`);
    let settled = false;
    const done = (status, extra = "") => {
      if (settled) return;
      settled = true;
      console.log(`  [${label}] -> ${status} ${extra}`.trimEnd());
      sb.removeChannel(channel).finally(() => resolve(status));
    };
    channel.on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, () => {});
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") done("SUBSCRIBED(握手+鉴权成功)");
      else if (status === "CHANNEL_ERROR") done("CHANNEL_ERROR", err?.message ? `(${err.message.slice(0, 80)})` : "");
      else if (status === "TIMED_OUT") done("TIMED_OUT");
      else console.log(`  [${label}] 中间状态: ${status}`);
    });
    // 兜底 12s
    setTimeout(() => done("12s 未确认"), 12000);
  });
}

console.log("\n连接探测:");
// 方式①  匿名, 不带用户 JWT —— 复现当前前端
await probe("匿名无会话", () => {});

// 方式②  把 Worker 拿到的 access_token 直接喂给 realtime (setAuth)
await probe("setAuth(用户JWT)", (sb) => sb.realtime.setAuth(access));

// 方式③  原生会话: setSession (持久化 access+refresh)
await probe("setSession原生会话", async (sb) => {
  await sb.auth.setSession({ access_token: access, refresh_token: refresh });
});
process.exit(0);
