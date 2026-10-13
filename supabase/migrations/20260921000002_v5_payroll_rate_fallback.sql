-- v5: 课酬结算视图补上「当前单价」兜底
--
-- 背景（生产上表现为「课酬页永远 0 元」）：
--   teacher_payroll 的 pay_amount 原本是
--     coalesce(l.pay_amount, l.pay_rate * l.duration_min / 60.0, 0)
--   即「快照优先，缺快照就按课节上的 pay_rate 折算」。但 pay_rate / pay_amount 是
--   20260919000005 才加的列，之前的历史课节全是 null；而消课流程当时也没有写快照
--   → 两层都取不到值 → pay_amount 恒为 0。
--
-- 现在消课时会写快照（见 packages/domain/src/lessonDelivery.js，单价为 0 时不写）。
-- 本迁移只补最后一层兜底：连 pay_rate 都没有时，用老师**当前**的 hourly_pay 折算，
-- 覆盖「先上课、后补设单价」这类历史课。
--
-- 优先级：课节快照 pay_amount > 课节快照 pay_rate > 老师当前 hourly_pay。
-- 因为快照仍是最高优先级，之后的调价不会影响已冻结的历史账单。
--
-- 幂等：create or replace view

create or replace view teacher_payroll as
  select
    t.profile_id                                        as teacher_id,
    p.full_name                                         as teacher_name,
    date_trunc('month', l.scheduled_at)::date           as month,
    count(l.id)                                         as lessons_done,
    coalesce(sum(l.duration_min), 0)                     as minutes_done,
    coalesce(
      sum(coalesce(l.pay_amount, coalesce(l.pay_rate, t.hourly_pay) * l.duration_min / 60.0)),
      0
    )::numeric(12,2) as pay_amount
  from teachers t
  join profiles p on p.id = t.profile_id
  join lessons l on l.teacher_id = t.profile_id and l.status = 'completed'
  group by t.profile_id, p.full_name, date_trunc('month', l.scheduled_at);

comment on view teacher_payroll is
  '按老师+月份统计已完成课节与课酬; pay_amount 优先取课节快照, 缺快照时依次回退到 pay_rate 与老师当前 hourly_pay';
