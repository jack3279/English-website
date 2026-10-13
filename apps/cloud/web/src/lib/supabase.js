import { createClient } from "@supabase/supabase-js";

// anon(publishable) key 本来就会被打进前端产物、可以公开 —— 见
// docs/手动部署流程-详细版.md §7.1（那里明确写了它不属于泄露，不用处理）。
const PUBLIC_ANON_KEY = "sb_publishable_8TYKVyCQLMatrxidWau8BQ_Vgzcxq8H";

// 生产兜底地址。理由与 lib/http.js 的 API 基址完全一样：.env.production 被 .gitignore
// 忽略，云端/CI 构建拿不到它。
// ⚠️ 这里原来只回落到 127.0.0.1 —— 后果是**生产环境实时订阅静默失效**：浏览器去连本机
// 54321，连不上也不报错，家长端「新反馈 / 课表变动自动刷新」就这么哑掉了，页面看着一切正常。
// 所以生产必须给真实地址，不要回落到 localhost。
const PROD_URL = "https://ueuerggzomryvisijdym.supabase.co";
const DEV_URL = "http://127.0.0.1:54321";

const url = import.meta.env.VITE_SUPABASE_URL || (import.meta.env.PROD ? PROD_URL : DEV_URL);
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || PUBLIC_ANON_KEY;

let _client = null;
export function getSupabase() {
  if (_client) return _client;
  _client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: window.localStorage,
    },
  });
  return _client;
}
