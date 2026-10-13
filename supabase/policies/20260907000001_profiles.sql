-- profiles: 所有已登录用户可看自己 + 同一校区的 profile
drop policy if exists "profiles_select_self_or_same_branch" on profiles;
create policy "profiles_select_self_or_same_branch"
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or branch_id = (select branch_id from profiles where id = auth.uid())
  );

-- 只有 admin 可改 profile（除了自己改自己）
drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin"
  on profiles for update
  to authenticated
  using (id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin')
  with check (id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin');
