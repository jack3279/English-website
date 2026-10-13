-- audit_log: 只有 admin 可读
create policy "audit_log_admin_select"
  on audit_log for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- 写由 BFF service-role 负责, 无 RLS insert policy
