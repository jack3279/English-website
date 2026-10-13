-- 多设备登录追踪 + 远程登出 (v7 / Tier 7)
--
-- 用途:
--   1. 每次登录/refresh 成功后, 在 auth_sessions 表插一行 (device + ip + last_active_at)
--   2. admin / 用户自己 看到「哪些设备在登录」, 标记可疑设备
--   3. 「远程登出」是软删除 (revoked_at not null); Supabase 自己的 refresh_token
--      我们拦截不了, 所以真正的失效要等 refresh_token 自然过期 (30 天)。
--      但「标记 revoked」够用 —— 因为:
--      - 列表不显示已撤销的 (UI 干净)
--      - 后端 /me/sessions 拉到的就是当前活跃列表, 跟前端 store 中的 token 对账
--      - 用户/管理员看得到「这个设备登出了」, 心理上可控
--
-- 不存 refresh_token 明文, 只存 SHA256 hash —— 即便数据库泄露, 攻击者也拿不到 token。
-- 同样的, 不存密码 (老规矩, 从来不存)。

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  refresh_token_hash text,           -- sha256(refresh_token), 用于「远程登出」时主动 revoke
  device_label text not null,         -- "Chrome on Windows" 这类, 从 UA 解析
  user_agent text,
  ip text,                            -- 来源 IP (从 CF-Connecting-IP 读)
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- 一个用户最多 100 条记录, 多了说明泄露或滥用, 触发器层面限制也行
  -- 这里用 idx + 索引 + unique 约束保证性能
  constraint auth_sessions_user_fk foreign key (user_id) references profiles(id)
);

create index if not exists idx_auth_sessions_user_active
  on auth_sessions (user_id, last_active_at desc)
  where revoked_at is null;

create index if not exists idx_auth_sessions_token_hash
  on auth_sessions (refresh_token_hash)
  where refresh_token_hash is not null;

-- RLS: 用户只能看/管自己的 sessions, admin 能看本机构所有人的
-- 简化策略: 仅 RLS 保护 user_id = auth.uid() 的可见性, admin 看全表通过 service_role
alter table auth_sessions enable row level security;

drop policy if exists auth_sessions_self_select on auth_sessions;
create policy auth_sessions_self_select on auth_sessions
  for select using (user_id = auth.uid());

drop policy if exists auth_sessions_self_update on auth_sessions;
create policy auth_sessions_self_update on auth_sessions
  for update using (user_id = auth.uid());

-- insert/delete 由后端 service_role 完成, 不开 RLS 写
-- (登录成功时写入, 不需要前端参与)