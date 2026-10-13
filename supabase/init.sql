-- Combined init (idempotent) 2026-09-11 16:49

-- === 20260907000001_init_enums.sql ===
-- 用户角色
create type user_role as enum ('admin', 'teacher', 'parent');

-- 课程状态
create type lesson_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');

-- 流水 reason
create type lesson_tx_reason as enum ('consume', 'refund', 'topup', 'adjust');

-- 请假状态
create type leave_status as enum ('pending', 'approved', 'rejected');


-- === 20260907000002_branches.sql ===
create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index idx_branches_code on branches (code);

-- seed demo 校区
insert into branches (id, name, code)
values ('00000000-0000-0000-0000-000000000001', '总部校区', 'HQ')
on conflict do nothing;


-- === 20260907000003_profiles.sql ===
-- profiles 1:1 关联 supabase auth.users
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null,
  full_name text not null,
  phone text,
  branch_id uuid references branches on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on profiles (role);
create index idx_profiles_branch on profiles (branch_id);

-- updated_at 自动维护 trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();


-- === 20260907000004_students_parents.sql ===
create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birth_date date,
  branch_id uuid references branches on delete set null,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create index idx_students_branch on students (branch_id);
create index idx_students_status on students (status);

create table parents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade unique,
  full_name text not null,
  created_at timestamptz not null default now()
);

create index idx_parents_profile on parents (profile_id);

create table parent_student_links (
  parent_id uuid not null references parents on delete cascade,
  student_id uuid not null references students on delete cascade,
  relation text not null default 'guardian',
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

create index idx_psl_student on parent_student_links (student_id);


-- === 20260907000005_courses_lessons.sql ===
create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid not null references profiles on delete restrict,
  branch_id uuid references branches on delete set null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_min int not null default 60 check (duration_min > 0),
  student_id uuid references students on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_courses_teacher on courses (teacher_id);
create index idx_courses_student on courses (student_id);
create index idx_courses_branch on courses (branch_id);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses on delete set null,
  teacher_id uuid not null references profiles on delete restrict,
  student_id uuid not null references students on delete restrict,
  scheduled_at timestamptz not null,
  duration_min int not null default 60,
  status lesson_status not null default 'scheduled',
  completed_at timestamptz,
  leave_status leave_status,
  leave_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lessons_teacher_scheduled on lessons (teacher_id, scheduled_at);
create index idx_lessons_student_scheduled on lessons (student_id, scheduled_at);
create index idx_lessons_status on lessons (status);

create trigger trg_lessons_updated_at
  before update on lessons
  for each row execute function set_updated_at();


-- === 20260907000006_records_lesson_transactions.sql ===
create table records (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons on delete cascade unique,
  content text not null,
  performance text,
  homework text,
  next_plan text,
  created_by uuid not null references profiles on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_records_lesson on records (lesson_id);

-- 课时流水 append-only
create table lesson_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete restrict,
  lesson_id uuid references lessons on delete set null,
  delta numeric(6,2) not null,
  reason lesson_tx_reason not null,
  note text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index idx_lt_student on lesson_transactions (student_id, created_at desc);
create index idx_lt_lesson on lesson_transactions (lesson_id);

-- 余额视图
create or replace view student_balance as
  select
    s.id as student_id,
    coalesce(sum(lt.delta), 0)::numeric(10,2) as remaining_hours
  from students s
  left join lesson_transactions lt on lt.student_id = s.id
  group by s.id;


-- === 20260907000007_parent_feeds.sql ===
create table parent_feeds (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records on delete cascade unique,
  student_id uuid not null references students on delete cascade,
  summary text not null,
  published_at timestamptz not null default now()
);

create index idx_parent_feeds_student_pub
  on parent_feeds (student_id, published_at desc);


-- === 20260907000008_audit_log.sql ===
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references profiles on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  payload jsonb,
  req_id text,
  created_at timestamptz not null default now()
);

create index idx_audit_actor_time on audit_log (actor, created_at desc);
create index idx_audit_target on audit_log (target_type, target_id);


-- === 20260907000009_teachers.sql ===
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


-- === 20260907000010_profiles.sql ===
-- profiles: 所有已登录用户可看自己 + 同一校区的 profile
create policy "profiles_select_self_or_same_branch"
  on profiles for select
  to authenticated
  using (
    id = auth.uid()
    or branch_id = (select branch_id from profiles where id = auth.uid())
  );

-- 只有 admin 可改 profile（除了自己改自己）
create policy "profiles_update_self_or_admin"
  on profiles for update
  to authenticated
  using (id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin')
  with check (id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin');


-- === 20260907000011_students.sql ===
-- students: admin/teacher 看全部
create policy "students_select_admin_teacher"
  on students for select
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
  );

-- parent 只看自己的孩子
create policy "students_select_own_children"
  on students for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = students.id and p.profile_id = auth.uid()
    )
  );

-- 只有 admin 可改
create policy "students_modify_admin"
  on students for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- === 20260907000012_lessons.sql ===
-- lessons: admin 全开
create policy "lessons_admin_all"
  on lessons for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- teacher 看自己的课
create policy "lessons_teacher_select_own"
  on lessons for select
  to authenticated
  using (
    teacher_id = (select id from teachers where profile_id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role = 'teacher')
  );

-- parent 看自己孩子的课
create policy "lessons_parent_select_own_children"
  on lessons for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = lessons.student_id and p.profile_id = auth.uid()
    )
  );


-- === 20260907000013_records.sql ===
-- records: admin/teacher 可读写
create policy "records_admin_teacher_all"
  on records for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === 20260907000014_lesson_transactions.sql ===
-- lesson_transactions: admin/teacher 可读写
create policy "lt_admin_teacher_all"
  on lesson_transactions for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === 20260907000015_parent_feeds.sql ===
-- parent_feeds: 家长可读自己孩子的
create policy "parent_feeds_parent_select_own"
  on parent_feeds for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = parent_feeds.student_id and p.profile_id = auth.uid()
    )
  );

-- admin/teacher 可写
create policy "parent_feeds_admin_teacher_write"
  on parent_feeds for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === 20260907000016_audit_log.sql ===
-- audit_log: 只有 admin 可读
create policy "audit_log_admin_select"
  on audit_log for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 写由 BFF service-role 负责, 无 RLS insert policy


-- === policies/20260907000001_profiles.sql ===
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


-- === policies/20260907000002_students.sql ===
-- students: admin/teacher 看全部
drop policy if exists "students_select_admin_teacher" on students;
create policy "students_select_admin_teacher"
  on students for select
  to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
  );

-- parent 只看自己的孩子
drop policy if exists "students_select_own_children" on students;
create policy "students_select_own_children"
  on students for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = students.id and p.profile_id = auth.uid()
    )
  );

-- 只有 admin 可改
drop policy if exists "students_modify_admin" on students;
create policy "students_modify_admin"
  on students for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- === policies/20260907000003_lessons.sql ===
-- lessons: admin 全开
drop policy if exists "lessons_admin_all" on lessons;
create policy "lessons_admin_all"
  on lessons for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- teacher 看自己的课
drop policy if exists "lessons_teacher_select_own" on lessons;
create policy "lessons_teacher_select_own"
  on lessons for select
  to authenticated
  using (
    teacher_id = (select id from teachers where profile_id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role = 'teacher')
  );

-- parent 看自己孩子的课
drop policy if exists "lessons_parent_select_own_children" on lessons;
create policy "lessons_parent_select_own_children"
  on lessons for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = lessons.student_id and p.profile_id = auth.uid()
    )
  );


-- === policies/20260907000004_records.sql ===
-- records: admin/teacher 可读写
drop policy if exists "records_admin_teacher_all" on records;
create policy "records_admin_teacher_all"
  on records for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === policies/20260907000005_lesson_transactions.sql ===
-- lesson_transactions: admin/teacher 可读写
drop policy if exists "lt_admin_teacher_all" on lesson_transactions;
create policy "lt_admin_teacher_all"
  on lesson_transactions for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === policies/20260907000006_parent_feeds.sql ===
-- parent_feeds: 家长可读自己孩子的
drop policy if exists "parent_feeds_parent_select_own" on parent_feeds;
create policy "parent_feeds_parent_select_own"
  on parent_feeds for select
  to authenticated
  using (
    exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = parent_feeds.student_id and p.profile_id = auth.uid()
    )
  );

-- admin/teacher 可写
drop policy if exists "parent_feeds_admin_teacher_write" on parent_feeds;
create policy "parent_feeds_admin_teacher_write"
  on parent_feeds for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- === policies/20260907000007_audit_log.sql ===
-- audit_log: 只有 admin 可读
drop policy if exists "audit_log_admin_select" on audit_log;
create policy "audit_log_admin_select"
  on audit_log for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 写由 BFF service-role 负责, 无 RLS insert policy

-- Placeholder. 真实 demo 数据通过 supabase/scripts/seed-users.mjs 灌入
-- (因为 auth.users 必须用 supabase admin API 创建, 不能纯 SQL seed)
select 'run supabase/scripts/seed-users.mjs after db reset' as hint;

