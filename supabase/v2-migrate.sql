-- Combined v2 migration (6 files in order)
-- Run in Supabase SQL Editor

-- ===== 20260912100001_v2_package_types.sql =====
-- v2 stage 1: package_types + student_packages + package_payments
-- Idempotent: 全部 if not exists 保护, 可重跑

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum ('new', 'contacted', 'trial_scheduled', 'converted', 'lost');
  end if;
end $$;

create table if not exists package_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hours numeric(6,2) not null check (hours > 0),
  price_cents int not null check (price_cents >= 0),
  active boolean default true,
  created_at timestamptz default now()
);

create unique index if not exists idx_package_types_name on package_types(name);

create table if not exists student_packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  package_type_id uuid references package_types,
  total_hours numeric(6,2) not null,
  remaining_hours numeric(6,2) not null,
  purchased_at timestamptz default now(),
  expires_at timestamptz,
  notes text
);
create index if not exists idx_student_packages_student on student_packages(student_id);
create index if not exists idx_student_packages_remaining on student_packages(remaining_hours);

create table if not exists package_payments (
  id uuid primary key default gen_random_uuid(),
  student_package_id uuid references student_packages,
  student_id uuid not null references students,
  amount_cents int not null,
  method text,
  paid_at timestamptz default now(),
  recorded_by uuid not null references profiles,
  notes text
);
create index if not exists idx_payments_student on package_payments(student_id);
create index if not exists idx_payments_package on package_payments(student_package_id);


-- ===== 20260912100004_v2_course_types.sql =====
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


-- ===== 20260912100005_v2_lessons_trial.sql =====
-- v2 stage 1: lessons trial 扩展 + lesson_transactions.student_package_id
-- Idempotent

alter table lessons add column if not exists is_trial boolean default false;
alter table lessons add column if not exists trial_parent_name text;
alter table lessons add column if not exists trial_parent_phone text;

alter table lesson_transactions add column if not exists student_package_id uuid references student_packages;
create index if not exists idx_lesson_tx_pkg on lesson_transactions(student_package_id);


-- ===== 20260912100006_v2_leads.sql =====
-- v2 stage 1: leads 表 (公开提交, 招生用)
-- Idempotent

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null,
  parent_phone text not null,
  child_name text,
  child_age int,
  preferred_time text,
  notes text,
  status lead_status not null default 'new',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  assigned_to uuid references profiles
);
create index if not exists idx_leads_status on leads(status, created_at desc);

-- updated_at 自动维护
create or replace function leads_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
  before update on leads
  for each row execute function leads_set_updated_at();


-- ===== 20260912100007_v2_internal_messages.sql =====
-- v2 stage 1: internal_messages 表 (站内信)
-- Idempotent

create table if not exists internal_messages (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references profiles on delete cascade,
  subject text,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_internal_messages_to on internal_messages(to_user, read_at);


-- ===== 20260912100008_v2_policies.sql =====
-- v2 stage 1: RLS policies (8 表)
-- 注意: RLS 默认 deny, 加 policy 前先 enable
-- service_role 走 global bypass, 不受影响
-- Idempotent: drop policy if exists + create

-- 1. package_types: 全部读, admin 写
alter table package_types enable row level security;

drop policy if exists "package_types_all_read" on package_types;
create policy "package_types_all_read" on package_types for select to authenticated using (true);

drop policy if exists "package_types_admin_all" on package_types;
create policy "package_types_admin_all" on package_types for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- 2. student_packages: admin 全, teacher 读, parent 读自己孩子的
alter table student_packages enable row level security;

drop policy if exists "student_packages_admin_all" on student_packages;
create policy "student_packages_admin_all" on student_packages for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "student_packages_teacher_read" on student_packages;
create policy "student_packages_teacher_read" on student_packages for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('teacher', 'admin')));

drop policy if exists "student_packages_parent_read" on student_packages;
create policy "student_packages_parent_read" on student_packages for select to authenticated
  using (exists (select 1 from parents p where p.profile_id = auth.uid() and p.id = student_packages.student_id));


-- 3. package_payments: admin 全
alter table package_payments enable row level security;

drop policy if exists "payments_admin_all" on package_payments;
create policy "payments_admin_all" on package_payments for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- 4. leads: 公开 insert, admin 改, admin/teacher 读
alter table leads enable row level security;

drop policy if exists "leads_public_insert" on leads;
create policy "leads_public_insert" on leads for insert to anon, authenticated with check (true);

drop policy if exists "leads_admin_all" on leads;
create policy "leads_admin_all" on leads for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "leads_staff_read" on leads;
create policy "leads_staff_read" on leads for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- 5. internal_messages: 自己收, admin 发
alter table internal_messages enable row level security;

drop policy if exists "internal_msg_self_read" on internal_messages;
create policy "internal_msg_self_read" on internal_messages for select to authenticated
  using (to_user = auth.uid() or exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "internal_msg_admin_insert" on internal_messages;
create policy "internal_msg_admin_insert" on internal_messages for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- 6. courses: admin 写, 全部读
alter table courses enable row level security;

drop policy if exists "courses_admin_all" on courses;
create policy "courses_admin_all" on courses for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "courses_all_read" on courses;
create policy "courses_all_read" on courses for select to authenticated using (true);


