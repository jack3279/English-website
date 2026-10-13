-- v8: 修正学员余额视图
--
-- 背景（线上实测 live-fullflow 暴露）：生产数据库此前停留在 20260907 的旧视图
-- （balance = SUM(lesson_transactions.delta)，完全不看课时包），v6 迁移未上线，
-- 且 v6 视图本身符号有误（完课 delta 为负，它却去“减”，会变相加）。
-- 后果：购买课时包后余额不增加 → 完课被 INSUFFICIENT_HOURS 阻断，
-- 核心「购包 → 上课 → 完课」链路中断。
--
-- 正确口径（各操作不重不漏）：
--   余额 = SUM(student_packages.remaining_hours)
--          + SUM(lesson_transactions.delta where reason in ('consume','adjust'))
--   · 课时包 remaining 已含「购买总额 − 退费」，故**不再**加 reason='refund' 流水（否则翻倍）；
--   · 完课不改包、只写 consume 流水，故计入；
--   · 课时调整写 adjust 流水，故计入。
--
-- create or replace，幂等；无论库当前是旧视图还是 v6 都可安全执行。

create or replace view student_balance as
select
  s.id as student_id,
  (
    coalesce(
      (select sum(sp.remaining_hours)
         from student_packages sp
        where sp.student_id = s.id),
      0
    )
    +
    coalesce(
      (select sum(lt.delta)
         from lesson_transactions lt
        where lt.student_id = s.id
          and lt.reason in ('consume', 'adjust')),
      0
    )
  )::numeric(10,2) as remaining_hours
from students s;

comment on view student_balance is
  '余额 = SUM(student_packages.remaining_hours) + SUM(consume/adjust 流水)；退费已减包，勿再加 refund 流水';

NOTIFY pgrst, 'reload schema';
