-- ⚠️ 已固化进 supabase/migrations/20260922000001_v6_consolidate_loose_fixes.sql ——
--    按 migrations 从零建库也会包含本文件内容。这里保留仅为历史参考，
--    改动请改迁移文件，不要只改这里。
-- 修复: profiles policy 引用 profiles 自己 -> 无限递归 (Postgres 42P17)
-- 原因: profiles_select_self_or_same_branch USING 含
--   "branch_id = (select branch_id from profiles where id = auth.uid())"
--   这个 subquery 查 profiles 表, 又触发 RLS USING, 循环.
-- 修法: 用 SECURITY DEFINER 函数绕过 RLS 评估.

create or replace function public.get_my_branch_id() returns uuid
language sql security definer stable as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.get_my_role() returns text
language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 重建 profiles SELECT policy
drop policy if exists "profiles_select_self_or_same_branch" on profiles;
create policy "profiles_select_self_or_same_branch"
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or branch_id = public.get_my_branch_id()
  );

-- 重建 profiles UPDATE policy
drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin"
  on profiles for update
  to authenticated
  using (id = auth.uid() or public.get_my_role() = 'admin')
  with check (id = auth.uid() or public.get_my_role() = 'admin');

-- 验证: 模拟一次 leads 查询 (会引用 profiles)
do $$
declare
  cnt int;
begin
  -- service_role 不能直接 RLS, 但要看函数能不能调用
  perform public.get_my_branch_id();
  raise notice 'functions OK';
exception when others then
  raise notice 'function error: %', sqlerrm;
end $$;