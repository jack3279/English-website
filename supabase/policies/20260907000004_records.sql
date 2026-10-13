-- records: admin/teacher 可读写
drop policy if exists "records_admin_teacher_all" on records;
create policy "records_admin_teacher_all"
  on records for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));
