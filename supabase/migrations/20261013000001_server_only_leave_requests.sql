begin;
-- Leave timestamps and deadline eligibility must be set by the server.
revoke insert, update, delete on public.leave_requests from public, anon, authenticated;
do $$
begin
  if not has_table_privilege('service_role', 'public.leave_requests', 'INSERT')
    or not has_table_privilege('service_role', 'public.leave_requests', 'UPDATE') then
    raise exception 'service_role must retain leave workflow write privileges';
  end if;
end $$;
commit;
select has_table_privilege('authenticated','public.leave_requests','INSERT') as browser_can_backdate_leave,
       has_table_privilege('service_role','public.leave_requests','INSERT') as server_can_submit_leave;
