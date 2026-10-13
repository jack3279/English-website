// 一次性 migrate 工具: GET /admin-migrations
// 检查 + 提供"一键 apply"的 SQL (含 NOTIFY pgrst, 'reload schema' 让 PostgREST
// 刷新 schema cache —— 不然就算表建好了, insert/select 也返 PGRST205)。
//
// 不要在 worker 里跑 DDL: Cloudflare Workers 不能直连 Supabase Postgres,
// 而 PostgREST / supabase-js 都不暴露任意 SQL 执行端点。
// 让 admin 在 Supabase Dashboard → SQL Editor 跑这段 SQL 是最稳的方式
// (SQL 模板见 readme 或本文件末尾的注释)。

const { requireAuth, requireRole } = require("../lib/auth.js");
const { ok } = require("../lib/http.js");
const { getAdmin } = require("../lib/supabase.js");

// 这一段 SQL 是 idempotent 的: 重复执行结果一致。
// user 在 Supabase Dashboard → SQL Editor 粘贴 + 跑一次即可。
//
// BEGIN;
//
// CREATE TABLE IF NOT EXISTS public.auth_sessions (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
//   refresh_token_hash text,
//   device_label text NOT NULL,
//   user_agent text,
//   ip text,
//   created_at timestamptz NOT NULL DEFAULT now(),
//   last_active_at timestamptz NOT NULL DEFAULT now(),
//   revoked_at timestamptz
// );
//
// CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
//   ON public.auth_sessions (user_id, last_active_at DESC)
//   WHERE revoked_at IS NULL;
//
// CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash
//   ON public.auth_sessions (refresh_token_hash)
//   WHERE refresh_token_hash IS NOT NULL;
//
// ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
//
// DROP POLICY IF EXISTS auth_sessions_self_select ON public.auth_sessions;
// CREATE POLICY auth_sessions_self_select ON public.auth_sessions
//   FOR SELECT USING (user_id = auth.uid());
//
// DROP POLICY IF EXISTS auth_sessions_self_update ON public.auth_sessions;
// CREATE POLICY auth_sessions_self_update ON public.auth_sessions
//   FOR UPDATE USING (user_id = auth.uid());
//
// NOTIFY pgrst, 'reload schema';
//
// COMMIT;
//
// 跑完后 worker 上的 recordSession / listMySessions / revokeSession 都会正常工作。

const MIGRATIONS = [
  {
    id: "v7_auth_sessions",
    description: "创建 auth_sessions 表 + RLS + PostgREST schema reload",
    // 通过 PostgREST introspection 检查 (query 返 200 = 表对 PostgREST 可见)
    // 这里跟查询走同一条路, 所以如果 list 成功但 insert 失败, 说明 schema cache
    // 是脏的 —— 需要跑 NOTIFY pgrst, 'reload schema' (见 SQL 注释块)。
    check: async () => {
      const { data, error } = await getAdmin().from("auth_sessions").select("id").limit(1);
      return {
        exists: !error && Array.isArray(data),
        error: error?.message,
        hint: error
          ? "POST /admin-migrations 没修不了 —— 必须去 Supabase SQL Editor 跑上面的 SQL"
          : null,
      };
    },
  },
];

module.exports = async function handler(req, res) {
  await requireAuth(req, res);
  requireRole(req, res, "admin");

  if (req.method === "GET") {
    const items = await Promise.all(
      MIGRATIONS.map(async (m) => {
        try {
          const c = await m.check();
          return {
            id: m.id,
            description: m.description,
            applied: c.exists,
            error: c.exists ? null : c.error,
            hint: c.hint,
          };
        } catch (e) {
          return { id: m.id, description: m.description, applied: false, error: e?.message };
        }
      }),
    );
    ok(res, { items });
    return;
  }
};
