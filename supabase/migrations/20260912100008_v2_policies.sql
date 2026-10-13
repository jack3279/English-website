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
