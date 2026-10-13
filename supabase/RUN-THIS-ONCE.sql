-- 一次性跑这份, 修复 Stage 1 RLS recursion + 加 internal_messages.from_user + 改 demo email 到 @17say.org
-- 在 Supabase SQL Editor 一次性执行, 全部 idempotent (重复跑安全)

-- =============================================================
-- 1. 修 profiles RLS recursion (Postgres 42P17) — 不跑这条 GET /leads 会一直 500
-- =============================================================

create or replace function public.get_my_branch_id() returns uuid
language sql security definer stable as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.get_my_role() returns text
language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "profiles_select_self_or_same_branch" on profiles;
create policy "profiles_select_self_or_same_branch"
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or branch_id = public.get_my_branch_id()
  );

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin"
  on profiles for update
  to authenticated
  using (id = auth.uid() or public.get_my_role() = 'admin')
  with check (id = auth.uid() or public.get_my_role() = 'admin');


-- =============================================================
-- 2. internal_messages 加 from_user FK (让站内信知道谁发的)
-- =============================================================

alter table internal_messages
  add column if not exists from_user uuid references profiles on delete set null;

create index if not exists idx_internal_messages_from on internal_messages(from_user);
create index if not exists idx_internal_messages_inbox on internal_messages(to_user, read_at, created_at desc);


-- =============================================================
-- 3. 改 7 个 demo user 的 email 到 @17say.org (品牌对齐)
-- =============================================================

DO $$
DECLARE
  mapping TEXT[][] := ARRAY[
    ['admin@demo.local',     'admin@17say.org'],
    ['emma@demo.local',      'emma@17say.org'],
    ['john@demo.local',      'john@17say.org'],
    ['lilyparent@demo.local','lilyparent@17say.org'],
    ['tomparent@demo.local', 'tomparent@17say.org'],
    ['aliceparent@demo.local','aliceparent@17say.org'],
    ['bobparent@demo.local', 'bobparent@17say.org']
  ];
  old_email TEXT;
  new_email TEXT;
  uid UUID;
  affected INT := 0;
BEGIN
  FOR i IN 1..array_length(mapping, 1) LOOP
    old_email := mapping[i][1];
    new_email := mapping[i][2];
    SELECT id INTO uid FROM auth.users WHERE email = old_email;
    IF uid IS NOT NULL THEN
      UPDATE auth.users SET email = new_email, email_confirmed_at = now() WHERE id = uid;
      UPDATE auth.identities
        SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(new_email))
        WHERE user_id = uid AND provider = 'email';
      affected := affected + 1;
      RAISE NOTICE 'updated % -> % (id=%)', old_email, new_email, uid;
    END IF;
  END LOOP;
  RAISE NOTICE 'total updated: %', affected;
END $$;


-- =============================================================
-- 验证 (跑完应该看到 7 个 @17say.org user + "functions OK" notice)
-- =============================================================
SELECT email, raw_user_meta_data->>'role' AS role
FROM auth.users
WHERE email LIKE '%@17say.org' OR email LIKE '%@demo.local'
ORDER BY email;

SELECT proname FROM pg_proc WHERE proname IN ('get_my_branch_id', 'get_my_role');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'internal_messages' AND column_name = 'from_user';