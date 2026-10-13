-- Run only after a complete backup. Preserve every row and shared teacher.
-- All scope changes are atomic; exclusive locks keep other writes out until
-- both classification triggers are restored and the transaction commits.
begin;
set local lock_timeout='10s';
lock table public.students,public.courses,public.lessons,public.records,public.parent_feeds,
 public.student_packages,public.package_payments,public.lesson_transactions,public.leave_requests,
 public.makeups,public.notifications,public.notification_reads,public.parent_student_links
 in access exclusive mode;
create temporary table smoke_scope_before on commit drop as
 select id,branch_id,is_test from public.students where left(full_name,9)='__SMOKE__' and not is_test;
do $$ begin
 if exists(select 1 from public.parent_student_links l join smoke_scope_before s on s.id=l.student_id)
 then raise exception 'Smoke students have family links: review them manually before archiving';end if;
end $$;
insert into public.branches(name,code,is_test) values('旧测试存档','ARCHIVED_SMOKE',true)
 on conflict(code) do update set is_test=true;
-- Only the two teacher-sharing classification triggers are suspended while
-- these tables are exclusively locked. They are re-enabled before commit.
alter table public.courses disable trigger assign_business_test_flag;
alter table public.lessons disable trigger assign_business_test_flag;
update public.students s set branch_id=(select id from public.branches where code='ARCHIVED_SMOKE'),is_test=true
 from smoke_scope_before x where s.id=x.id;
update public.courses set is_test=true,branch_id=(select id from public.branches where code='ARCHIVED_SMOKE') where student_id in(select id from smoke_scope_before);
update public.lessons set is_test=true where student_id in(select id from smoke_scope_before);
alter table public.courses enable trigger assign_business_test_flag;
alter table public.lessons enable trigger assign_business_test_flag;
update public.records set is_test=true where lesson_id in(select id from public.lessons where student_id in(select id from smoke_scope_before));
update public.parent_feeds set is_test=true where student_id in(select id from smoke_scope_before);
update public.student_packages set is_test=true where student_id in(select id from smoke_scope_before);
update public.package_payments set is_test=true where student_id in(select id from smoke_scope_before);
update public.lesson_transactions set is_test=true where student_id in(select id from smoke_scope_before);
update public.leave_requests set is_test=true where student_id in(select id from smoke_scope_before);
update public.makeups set is_test=true where student_id in(select id from smoke_scope_before);
update public.notifications set is_test=true where student_id in(select id from smoke_scope_before);
update public.notification_reads set is_test=true where notification_id in(select id from public.notifications where student_id in(select id from smoke_scope_before));
insert into public.audit_log(action,target_type,payload)
select 'launch.archive_explicit_smoke','students',jsonb_build_object('classification_only',true,'original_students',coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb),'source','__SMOKE__ exact prefix') from smoke_scope_before s;
do $$ begin
 if exists(select 1 from public.students where left(full_name,9)='__SMOKE__' and not is_test)
 then raise exception 'Classification incomplete';end if;
 if exists(select 1 from pg_trigger where tgrelid in('public.lessons'::regclass,'public.courses'::regclass) and tgname='assign_business_test_flag' and tgenabled<>'O')
 then raise exception 'Classification triggers must remain enabled';end if;
end $$;
select count(*) as moved_test_students from smoke_scope_before;
commit;
select (select count(*) from public.students where left(full_name,9)='__SMOKE__' and is_test) as archived_test_students,
 (select count(*) from public.students where left(full_name,9)='__SMOKE__' and not is_test) as test_students_remaining_in_production,
 (select count(*) from public.students) as students_preserved,
 (select count(*) from public.teachers) as teachers_preserved,
 (select count(*) from pg_trigger where tgrelid in('public.lessons'::regclass,'public.courses'::regclass) and tgname='assign_business_test_flag' and tgenabled='O') as classification_guards_enabled;
