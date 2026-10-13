-- Keep all business records; classify the explicitly named simulation branch.
begin;
do $$ declare t text; begin
 foreach t in array array['branches','profiles','students','teachers','parents','parent_student_links','package_types','student_packages','package_payments','courses','lessons','records','parent_feeds','lesson_transactions','leave_requests','makeups','notifications','notification_reads','announcements','materials','internal_messages','leads','reminder_log','audit_log','auth_sessions','course_types'] loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I add column if not exists is_test boolean not null default false',t);end if;
 end loop;
end $$;

update public.branches set is_test=true where code='SIM20261011CN';
update public.profiles p set is_test=true where exists(select 1 from public.branches b where b.id=p.branch_id and b.is_test);
update public.students s set is_test=true where exists(select 1 from public.branches b where b.id=s.branch_id and b.is_test);
update public.teachers t set is_test=true where exists(select 1 from public.profiles p where p.id=t.profile_id and p.is_test);
update public.parents t set is_test=true where exists(select 1 from public.profiles p where p.id=t.profile_id and p.is_test);
update public.courses c set is_test=true where exists(select 1 from public.branches b where b.id=c.branch_id and b.is_test);
update public.package_types set is_test=true where name in ('10课时体验包（模拟数据）','20课时体验包（模拟数据）','30课时体验包（模拟数据）');
do $$ declare t text; begin
 foreach t in array array['parent_student_links','student_packages','package_payments','lessons','parent_feeds','lesson_transactions','leave_requests','makeups'] loop
  execute format('update public.%I x set is_test=true where exists(select 1 from public.students s where s.id=x.student_id and s.is_test)',t);
 end loop;
end $$;
update public.records r set is_test=true where exists(select 1 from public.lessons l where l.id=r.lesson_id and l.is_test);
update public.auth_sessions r set is_test=true where exists(select 1 from public.profiles p where p.id=r.user_id and p.is_test);
update public.notifications n set is_test=true where exists(select 1 from public.students s where s.id=n.student_id and s.is_test) or exists(select 1 from public.profiles p where p.id=n.target_user and p.is_test);
update public.notification_reads r set is_test=true where exists(select 1 from public.notifications n where n.id=r.notification_id and n.is_test);
update public.internal_messages r set is_test=true where exists(select 1 from public.profiles p where p.id=r.from_user and p.is_test);

-- Portal privileges are held in server-controlled app metadata. A test admin
-- has a parent database role, so a Supabase JWT cannot bypass portal isolation.
update auth.users u set raw_app_meta_data=coalesce(u.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('is_test_admin',true)
from public.profiles p where p.id=u.id and p.is_test and p.role='admin';
update public.profiles set role='parent' where is_test and role='admin';

create or replace function public.protect_profile_privileges() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()='authenticated' and (new.role is distinct from old.role or new.branch_id is distinct from old.branch_id or new.is_test is distinct from old.is_test) then
  raise exception 'Role, branch and test classification must be changed through the management API' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges before update on public.profiles for each row execute function public.protect_profile_privileges();

create or replace function public.assign_business_test_flag() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(new);flag boolean:=new.is_test;other_flag boolean;begin
 if tg_table_name in ('profiles','students','courses') and j->>'branch_id' is not null then select is_test into flag from public.branches where id=(j->>'branch_id')::uuid;
 elsif j->>'student_id' is not null then select is_test into flag from public.students where id=(j->>'student_id')::uuid;
 elsif j->>'profile_id' is not null then select is_test into flag from public.profiles where id=(j->>'profile_id')::uuid;
 elsif j->>'lesson_id' is not null then select is_test into flag from public.lessons where id=(j->>'lesson_id')::uuid;
 elsif j->>'record_id' is not null then select is_test into flag from public.records where id=(j->>'record_id')::uuid;
 elsif j->>'notification_id' is not null then select is_test into flag from public.notifications where id=(j->>'notification_id')::uuid;
 elsif j->>'user_id' is not null then select is_test into flag from public.profiles where id=(j->>'user_id')::uuid;
 elsif j->>'target_user' is not null then select is_test into flag from public.profiles where id=(j->>'target_user')::uuid;
 elsif j->>'from_user' is not null then select is_test into flag from public.profiles where id=(j->>'from_user')::uuid;
 end if;
 new.is_test:=coalesce(flag,false);
 if tg_table_name in ('lessons','courses') and j->>'teacher_id' is not null then
  select is_test into other_flag from public.profiles where id=(j->>'teacher_id')::uuid;
  if other_flag is distinct from new.is_test then raise exception 'Test and production records cannot be linked';end if;
 end if;
 if tg_table_name='parent_student_links' then select is_test into other_flag from public.parents where id=new.parent_id;
  if other_flag is distinct from new.is_test then raise exception 'Test and production family links cannot be mixed';end if;
 end if;
 if tg_table_name='profiles' then
 if new.is_test and j->>'role'='admin' then
  if auth.role()='authenticated' then raise exception 'Test portal privileges require service approval' using errcode='42501';end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('is_test_admin',true) where id=new.id;
  new.role:='parent';
 end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['profiles','students','teachers','parents','parent_student_links','courses','lessons','records','parent_feeds','student_packages','package_payments','lesson_transactions','leave_requests','makeups','notifications','notification_reads','internal_messages','auth_sessions'] loop
  execute format('drop trigger if exists assign_business_test_flag on public.%I',t);
  execute format('create trigger assign_business_test_flag before insert or update on public.%I for each row execute function public.assign_business_test_flag()',t);
 end loop;
end $$;

-- Append flags without changing the existing balance/payroll calculations.
do $$ declare v text;definition text; begin
 foreach v in array array['student_balance','teacher_payroll'] loop
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=v and column_name='is_test') then
   select regexp_replace(pg_get_viewdef(('public.'||v)::regclass,true),';\s*$','') into definition;
   if v='student_balance' then execute format('create or replace view public.%I as select x.*,coalesce((select s.is_test from public.students s where s.id=x.student_id),false) as is_test from (%s) x',v,definition);
   else execute format('create or replace view public.%I as select x.*,coalesce((select p.is_test from public.profiles p where p.id=x.teacher_id),false) as is_test from (%s) x',v,definition);end if;
  end if;
  execute format('alter view public.%I set (security_invoker=true)',v);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
select 'classification_and_privilege_guard_ready' as result,
 (select count(*) from public.students where is_test) as test_students,
 (select count(*) from public.teachers where is_test) as test_teachers,
 (select sum(amount_cents) from public.package_payments where is_test) as test_receipts_cents;
