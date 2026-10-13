-- 学员五状态 + 级联永久删除（清理假数据）
-- 在读 active / 停课 inactive / 休学 leave / 结课 graduated / 退费 refunded
-- 在 Supabase Dashboard → SQL Editor 整段执行；幂等，可重复运行。
begin;

-- 1) 收敛历史脏值：任何非 active/inactive 的未知状态先归为停课，
--    避免加 CHECK 约束时失败。已知历史只有 active/inactive。
update public.students
set status = 'inactive'
where status is null
   or status not in ('active', 'inactive', 'leave', 'graduated', 'refunded');

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'students_status_check'
  ) then
    alter table public.students
      add constraint students_status_check
      check (status in ('active', 'inactive', 'leave', 'graduated', 'refunded'));
  end if;
end $$;

-- 状态筛选已有 idx_students_status（init.sql），无需新建。

-- 2) 级联删除预览：只计数、不写库。计数口径与真正删除完全一致。
create or replace function public.purge_student_preview(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
  c_lessons int; c_records int; c_feeds int; c_transactions int; c_payments int;
  c_packages int; c_links int; c_leaves int; c_makeups int;
  c_notifications int; c_notification_reads int; c_materials int;
begin
  select exists(select 1 from public.students where id = p_student) into v_exists;
  if not v_exists then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'no_data';
  end if;

  select count(*) into c_lessons            from public.lessons            where student_id = p_student;
  select count(*) into c_records            from public.records r
    where r.lesson_id in (select id from public.lessons where student_id = p_student);
  select count(*) into c_feeds              from public.parent_feeds        where student_id = p_student;
  select count(*) into c_transactions       from public.lesson_transactions where student_id = p_student;
  select count(*) into c_payments           from public.package_payments   where student_id = p_student;
  select count(*) into c_packages           from public.student_packages   where student_id = p_student;
  select count(*) into c_links              from public.parent_student_links where student_id = p_student;
  select count(*) into c_leaves             from public.leave_requests     where student_id = p_student;
  select count(*) into c_makeups            from public.makeups            where student_id = p_student;
  select count(*) into c_notifications      from public.notifications      where student_id = p_student;
  select count(*) into c_notification_reads from public.notification_reads nr
    where nr.notification_id in (select id from public.notifications where student_id = p_student);
  select count(*) into c_materials          from public.materials          where student_id = p_student;

  return jsonb_build_object(
    'student', p_student,
    'lessons', c_lessons,
    'records', c_records,
    'parent_feeds', c_feeds,
    'lesson_transactions', c_transactions,
    'package_payments', c_payments,
    'student_packages', c_packages,
    'parent_student_links', c_links,
    'leave_requests', c_leaves,
    'makeups', c_makeups,
    'notifications', c_notifications,
    'notification_reads', c_notification_reads,
    'materials', c_materials
  );
end $$;

-- 3) 真正级联删除：在单个事务（函数调用）内按外键阻塞顺序删除。
--    courses.student_id 为 on delete set null，会自动脱钩；
--    家长/教师账号、profiles、auth.users 一律保留。
create or replace function public.purge_student(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
  c_lessons int; c_records int; c_feeds int; c_transactions int; c_payments int;
  c_packages int; c_links int; c_leaves int; c_makeups int;
  c_notifications int; c_notification_reads int; c_materials int;
begin
  select exists(select 1 from public.students where id = p_student) into v_exists;
  if not v_exists then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'no_data';
  end if;

  -- 与 preview 相同的计数（删除前快照）
  select count(*) into c_lessons            from public.lessons            where student_id = p_student;
  select count(*) into c_records            from public.records r
    where r.lesson_id in (select id from public.lessons where student_id = p_student);
  select count(*) into c_feeds              from public.parent_feeds        where student_id = p_student;
  select count(*) into c_transactions       from public.lesson_transactions where student_id = p_student;
  select count(*) into c_payments           from public.package_payments   where student_id = p_student;
  select count(*) into c_packages           from public.student_packages   where student_id = p_student;
  select count(*) into c_links              from public.parent_student_links where student_id = p_student;
  select count(*) into c_leaves             from public.leave_requests     where student_id = p_student;
  select count(*) into c_makeups            from public.makeups            where student_id = p_student;
  select count(*) into c_notifications      from public.notifications      where student_id = p_student;
  select count(*) into c_notification_reads from public.notification_reads nr
    where nr.notification_id in (select id from public.notifications where student_id = p_student);
  select count(*) into c_materials          from public.materials          where student_id = p_student;

  -- 必须先删 RESTRICT / NO ACTION 的阻塞方（缴费、流水、课节、记录），
  -- 顺序与 supabase/cleanup_test_data.sql 已验证流程一致。
  delete from public.notification_reads
  where notification_id in (select id from public.notifications where student_id = p_student);
  delete from public.notifications      where student_id = p_student;
  delete from public.package_payments   where student_id = p_student;
  delete from public.lesson_transactions where student_id = p_student;
  delete from public.parent_feeds       where student_id = p_student;
  delete from public.records
  where lesson_id in (select id from public.lessons where student_id = p_student);
  delete from public.makeups            where student_id = p_student;
  delete from public.leave_requests     where student_id = p_student;
  delete from public.lessons            where student_id = p_student;
  delete from public.student_packages   where student_id = p_student;
  delete from public.materials          where student_id = p_student;
  delete from public.parent_student_links where student_id = p_student;
  delete from public.students           where id = p_student;

  return jsonb_build_object(
    'student', p_student,
    'lessons', c_lessons,
    'records', c_records,
    'parent_feeds', c_feeds,
    'lesson_transactions', c_transactions,
    'package_payments', c_payments,
    'student_packages', c_packages,
    'parent_student_links', c_links,
    'leave_requests', c_leaves,
    'makeups', c_makeups,
    'notifications', c_notifications,
    'notification_reads', c_notification_reads,
    'materials', c_materials
  );
end $$;

-- 仅允许服务端 service_role 执行；浏览器角色（anon/authenticated/public）无权调用。
revoke execute on function public.purge_student(uuid) from public, anon, authenticated;
revoke execute on function public.purge_student_preview(uuid) from public, anon, authenticated;
grant execute on function public.purge_student(uuid) to service_role;
grant execute on function public.purge_student_preview(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
