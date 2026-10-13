-- Cleanup before re-running init.sql
-- 先在 Supabase SQL Editor 跑这个清干净, 再跑 init.sql

do $$ declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename in (
    'branches', 'profiles', 'students', 'parents', 'teachers', 'parent_student_links',
    'courses', 'lessons', 'records', 'lesson_transactions', 'parent_feeds', 'audit_log'
  )
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  for r in select typname from pg_type where typname in (
    'user_role', 'lesson_status', 'lesson_tx_reason', 'leave_status'
  ) and typnamespace = (select oid from pg_namespace where nspname = 'public')
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;

drop function if exists public.set_updated_at() cascade;
drop view if exists public.student_balance cascade;
