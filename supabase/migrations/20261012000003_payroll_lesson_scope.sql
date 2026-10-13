-- Classify payroll by the lesson scope, including legacy mixed-profile rows.
-- Paid student absences are payable; old zero-pay absences stay unchanged.
begin;
create or replace view public.teacher_payroll with (security_invoker=true) as
select t.profile_id as teacher_id,p.full_name as teacher_name,
 date_trunc('month',l.scheduled_at)::date as month,
 count(l.id) as lessons_done,coalesce(sum(l.duration_min),0) as minutes_done,
 coalesce(sum(coalesce(l.pay_amount,l.pay_rate*l.duration_min::numeric/60.0)),0)::numeric(12,2) as pay_amount,
 l.is_test
from public.teachers t join public.profiles p on p.id=t.profile_id
join public.lessons l on l.teacher_id=t.profile_id and
 (l.status='completed' or (l.status='no_show' and l.pay_amount>0))
group by t.profile_id,p.full_name,date_trunc('month',l.scheduled_at),l.is_test;
notify pgrst,'reload schema';
commit;
