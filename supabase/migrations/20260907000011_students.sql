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
