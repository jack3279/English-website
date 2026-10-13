-- ============================================================================
-- 正式上线只读核查（5 个 20261012 迁移）
-- 整段都是 SELECT / 目录表查询，不写库、不改权限、不删数据，可重复执行。
-- 在 Supabase Dashboard → SQL Editor 中整段运行，逐项核对 expected 列。
-- ============================================================================

-- ① 测试数据隔离：业务表 is_test 列是否齐全（期望每张表 has_column = true）
select '① is_test 列' as section, table_name,
       exists(
         select 1 from information_schema.columns c
         where c.table_schema='public' and c.table_name=t.table_name and c.column_name='is_test'
       ) as ok
from (values
  ('branches'),('profiles'),('students'),('teachers'),('parents'),
  ('parent_student_links'),('package_types'),('student_packages'),('package_payments'),
  ('courses'),('lessons'),('records'),('parent_feeds'),('lesson_transactions'),
  ('leave_requests'),('makeups'),('notifications'),('notification_reads'),
  ('announcements'),('materials'),('internal_messages'),('leads'),('reminder_log'),
  ('audit_log'),('auth_sessions'),('course_types')
) as t(table_name)
order by table_name;

-- ② 权限保护 / 测试标记触发器是否就位（期望每个 trigger 一行、present = true）
select '② 触发器' as section, event_object_table as table_name, trigger_name, true as present
from information_schema.triggers
where trigger_schema='public'
  and trigger_name in ('protect_profile_privileges','assign_business_test_flag')
order by event_object_table, trigger_name;

-- ③ 课酬视图：按 lessons.is_test 分类 + 付费缺勤计薪（期望 ok = true）
--    判定标准：视图定义里同时出现 l.is_test 和 no_show / pay_amount
select '③ teacher_payroll 视图' as section,
       exists(select 1 from information_schema.views where table_schema='public' and table_name='teacher_payroll') as view_exists,
       (
         select strpos(pg_get_viewdef('public.teacher_payroll'::regclass, true), 'l.is_test') > 0
       ) as classifies_by_lesson_scope,
       (
         select strpos(pg_get_viewdef('public.teacher_payroll'::regclass, true), 'no_show') > 0
       ) as paid_absence_payable;

-- ④ 缺勤管理员复核：5 个新列 + CHECK 约束 + 待复核索引（期望全部 true）
select '④ 缺勤复核列' as section, column_name, true as ok
from information_schema.columns
where table_schema='public' and table_name='lessons'
  and column_name in (
    'absence_review_status','absence_deduct_hours','absence_pay_teacher',
    'absence_reviewed_by','absence_reviewed_at'
  )
order by column_name;

select '④ 约束/索引' as section,
  exists(select 1 from pg_constraint where conname='lessons_absence_review_status_check') as check_constraint_ok,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='lessons_pending_absence_review') as pending_index_ok;

-- ⑤ 财务表只允许服务端写：浏览器角色无写权限（期望全部 false），service_role 可写（期望全 true）
select '⑤ 财务写权限' as section, t.table_name,
  has_table_privilege('authenticated', 'public.'||t.table_name, 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.'||t.table_name, 'UPDATE') as auth_update,
  has_table_privilege('authenticated', 'public.'||t.table_name, 'DELETE') as auth_delete,
  has_table_privilege('service_role',  'public.'||t.table_name, 'INSERT') as service_insert,
  has_table_privilege('service_role',  'public.'||t.table_name, 'UPDATE') as service_update,
  has_table_privilege('service_role',  'public.'||t.table_name, 'DELETE') as service_delete
from (values
  ('lessons'),('lesson_transactions'),('teachers'),
  ('package_types'),('student_packages'),('package_payments')
) as t(table_name)
order by table_name;

-- ⑥ 现有正式数据规模快照（只读计数，确认数据仍在、未被种子/清理影响）
select '⑥ 正式数据计数(is_test=false)' as section,
  (select count(*) from public.students where is_test=false)  as production_students,
  (select count(*) from public.teachers where is_test=false)  as production_teachers,
  (select count(*) from public.lessons   where is_test=false) as production_lessons,
  (select count(*) from public.student_packages where is_test=false) as production_packages,
  (select count(*) from public.package_payments where is_test=false) as production_payments;
