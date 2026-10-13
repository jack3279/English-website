-- teachers 是 profiles 的扩展（1:1 teacher role profile）
-- 补这张表是因为 RLS policy 引用了它
create table teachers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade unique,
  specialties text,
  default_rate numeric(10,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_teachers_profile on teachers (profile_id);
