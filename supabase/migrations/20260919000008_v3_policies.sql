-- v3: 新增表的 RLS 策略
-- 约定: service_role 走全局 bypass, 不受 policy 限制 (Worker 用 service_role 读写)
-- Idempotent: drop policy if exists + create

-- ============ notifications ============
alter table notifications enable row level security;

-- 可见 = 定向给我 / 广播给我的角色 / 全员
drop policy if exists "notifications_select_visible" on notifications;
create policy "notifications_select_visible" on notifications for select to authenticated
  using (
    target_user = auth.uid()
    or target_role = (select role from profiles where id = auth.uid())
    or (target_user is null and target_role is null)
  );

-- ============ notification_reads ============
-- 只能读写"自己"的已读记录
alter table notification_reads enable row level security;

drop policy if exists "notification_reads_self_select" on notification_reads;
create policy "notification_reads_self_select" on notification_reads for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notification_reads_self_insert" on notification_reads;
create policy "notification_reads_self_insert" on notification_reads for insert to authenticated
  with check (user_id = auth.uid());


-- ============ leave_requests ============
alter table leave_requests enable row level security;

drop policy if exists "leave_admin_all" on leave_requests;
create policy "leave_admin_all" on leave_requests for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 老师看自己学生的请假; 家长看自己孩子的
drop policy if exists "leave_staff_parent_read" on leave_requests;
create policy "leave_staff_parent_read" on leave_requests for select to authenticated
  using (
    exists (
      select 1 from lessons l
      where l.student_id = leave_requests.student_id and l.teacher_id = auth.uid()
    )
    or exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = leave_requests.student_id and p.profile_id = auth.uid()
    )
  );

-- 家长 / 老师可为关联学员提交请假
drop policy if exists "leave_insert_related" on leave_requests;
create policy "leave_insert_related" on leave_requests for insert to authenticated
  with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
    or exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = leave_requests.student_id and p.profile_id = auth.uid()
    )
  );


-- ============ makeups ============
alter table makeups enable row level security;

drop policy if exists "makeups_admin_all" on makeups;
create policy "makeups_admin_all" on makeups for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "makeups_read_related" on makeups;
create policy "makeups_read_related" on makeups for select to authenticated
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
    or exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = makeups.student_id and p.profile_id = auth.uid()
    )
  );


-- ============ announcements ============
alter table announcements enable row level security;

drop policy if exists "announcements_read" on announcements;
create policy "announcements_read" on announcements for select to authenticated
  using (audience is null or audience = (select role from profiles where id = auth.uid()));

drop policy if exists "announcements_admin_all" on announcements;
create policy "announcements_admin_all" on announcements for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));


-- ============ materials ============
alter table materials enable row level security;

-- 通用教材 (student_id 为空) 所有人可读
drop policy if exists "materials_read" on materials;
create policy "materials_read" on materials for select to authenticated
  using (
    student_id is null
    or exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
    or exists (
      select 1
      from parent_student_links psl
      join parents p on p.id = psl.parent_id
      where psl.student_id = materials.student_id and p.profile_id = auth.uid()
    )
  );

drop policy if exists "materials_staff_write" on materials;
create policy "materials_staff_write" on materials for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));


-- ============ reminder_log ============
-- 只给 service_role 用: 开启 RLS 但不建任何 policy = 普通用户与 anon 全 deny
alter table reminder_log enable row level security;
