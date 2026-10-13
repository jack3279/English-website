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
