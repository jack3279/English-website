-- 把散落在 supabase/*.sql 里的三处「事后修复」固化进迁移链。
--
-- 为什么需要这一步：这三处修复原先只存在于独立文件里，**不在 migrations 里**。
-- 生产库当时是手工执行过、所以是好的；但任何人按 migrations 从零建库（或重建库、
-- 或换环境），都会得到一个**口径错误的 student_balance 视图**和缺了 policy 的表 ——
-- 而这类问题不会立刻报错，只会表现为「余额显示不对 / 标记已读失败」。
--
-- 三处修复本身都是幂等的（create or replace / drop policy if exists），重复执行安全。
-- 来源文件：supabase/fix-student-balance-view.sql、supabase/fix-v2-rls-recursion.sql、
--          supabase/fix-internal-msg-update-policy.sql

-- ============================================================
-- 1) student_balance 视图：必须同时算上 student_packages 的余额
-- ============================================================
-- 原视图（migration 20260907000006）只 sum(lesson_transactions.delta)。
-- 但买课时包走的是 packages/purchase，只往 student_packages.remaining_hours 充，
-- 不产生 lesson_transactions 流水 —— 于是「买完包余额不涨」。
-- 正确口径：包内余额之和 − 与课节关联的消耗/退款流水。
create or replace view student_balance as
select
  s.id as student_id,
  coalesce(
    (
      select sum(sp.remaining_hours)
      from student_packages sp
      where sp.student_id = s.id
    ),
    0
  )
  -
  coalesce(
    (
      select sum(lt.delta)
      from lesson_transactions lt
      where lt.student_id = s.id
        and lt.reason in ('consume', 'refund')
        and lt.lesson_id is not null
    ),
    0
  ) as remaining_hours
from students s;

comment on view student_balance is
  '学员余额 = SUM(student_packages.remaining_hours) − SUM(与课节关联的 consume/refund 流水)。不要把买包并进流水，两套口径只能留一套。';

-- ============================================================
-- 2) profiles 的 RLS 自引用递归（Postgres 42P17）
-- ============================================================
-- profiles_select_self_or_same_branch 的 USING 里子查询 profiles 表，又触发 RLS，
-- 无限递归。修法：用 SECURITY DEFINER 函数绕过 RLS 评估。
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

-- ============================================================
-- 3) internal_messages 缺 UPDATE policy（标记已读会被 RLS 拒）
-- ============================================================
alter table internal_messages enable row level security;

drop policy if exists "internal_msg_mark_read" on internal_messages;
create policy "internal_msg_mark_read" on internal_messages
  for update to authenticated
  using (to_user = auth.uid())
  with check (to_user = auth.uid());

-- 让 PostgREST 立刻重载 schema cache（改过列/策略后不重载会出现「查不到列」的怪症状）
notify pgrst, 'reload schema';
