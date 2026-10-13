-- All financial writes use the authenticated management API's service client.
-- Supabase browser sessions retain SELECT/Realtime access, but cannot bypass review.
begin;
revoke insert,update,delete on public.lessons,public.lesson_transactions,public.teachers,public.package_types,public.student_packages,public.package_payments from public,anon,authenticated;
do $$ declare t text; begin foreach t in array array['lessons','lesson_transactions','teachers','package_types','student_packages','package_payments'] loop
 if not has_table_privilege('service_role','public.'||t,'INSERT') or not has_table_privilege('service_role','public.'||t,'UPDATE') or not has_table_privilege('service_role','public.'||t,'DELETE') then raise exception 'API service write permissions would be lost for %',t;end if;
end loop;end $$;
notify pgrst,'reload schema';
commit;
select has_table_privilege('authenticated','public.lessons','UPDATE') as browser_can_edit_settlement,
 has_table_privilege('authenticated','public.teachers','UPDATE') as browser_can_edit_pay_rate,
 has_table_privilege('service_role','public.lessons','UPDATE') as management_api_can_write;
