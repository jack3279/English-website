-- 用户角色
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'teacher', 'parent');
  end if;
  if not exists (select 1 from pg_type where typname = 'lesson_status') then
    create type lesson_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
  end if;
  if not exists (select 1 from pg_type where typname = 'lesson_tx_reason') then
    create type lesson_tx_reason as enum ('consume', 'refund', 'topup', 'adjust');
  end if;
  if not exists (select 1 from pg_type where typname = 'leave_status') then
    create type leave_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;
