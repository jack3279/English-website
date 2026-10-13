-- lesson_transactions: admin/teacher 可读写
drop policy if exists "lt_admin_teacher_all" on lesson_transactions;
create policy "lt_admin_teacher_all"
  on lesson_transactions for all
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher')));
