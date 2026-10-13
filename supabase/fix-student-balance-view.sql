-- ⚠️ 已固化进 supabase/migrations/20260922000001_v6_consolidate_loose_fixes.sql ——
--    按 migrations 从零建库也会包含本文件内容。这里保留仅为历史参考，
--    改动请改迁移文件，不要只改这里。
-- 修复 student_balance view: 包括 student_packages 余额 + 扣减 lesson_transactions
-- 之前 view 只 sum lesson_transactions.delta, 但 student_packages 也有 remaining_hours
-- (通过 packages purchase 充值, 通过 lesson_transactions consume 扣减)
-- 正确算法: balance = SUM(student_packages.remaining_hours) + SUM(lesson_transactions.delta where not linked to package)

create or replace view student_balance as
select
  s.id as student_id,
  coalesce(
    (
      select sum(sp.remaining_hours)
      from student_packages sp
      where sp.student_id = s.id
    ),
    0
  )
  -
  coalesce(
    (
      select sum(lt.delta)
      from lesson_transactions lt
      where lt.student_id = s.id
        and lt.reason in ('consume', 'refund')
        and lt.lesson_id is not null
    ),
    0
  ) as remaining_hours
from students s;

-- 验证
select
  (select count(*) from students) as students,
  (select count(*) from student_packages) as packages,
  (select count(*) from lesson_transactions where lesson_id is not null) as consume_txs;