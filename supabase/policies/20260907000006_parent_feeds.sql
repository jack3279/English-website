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
