-- v2 stage 1: course_type enum + 课程扩展
-- Idempotent

do $$ begin
  if not exists (select 1 from pg_type where typname = 'course_type') then
    create type course_type as enum ('one_on_one', 'small_group', 'large_group', 'trial');
  end if;
end $$;

alter table courses add column if not exists type course_type default 'one_on_one';
alter table courses add column if not exists capacity int default 1 check (capacity > 0);
alter table courses add column if not exists price_per_hour_cents int;
