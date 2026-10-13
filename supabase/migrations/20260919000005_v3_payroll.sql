-- v3: 老师课酬结算
-- 说明: teachers.default_rate 是历史字段, seed 里值为 25000/30000/22000, 单位疑似"分/小时",
--       语义不明确, 不直接用于结算。新增 hourly_pay = 课酬单价(主单位/小时), 语义显式。
-- lessons.pay_rate / pay_amount 是下单时的快照, 之后改单价不影响历史账单。
-- Idempotent

alter table teachers add column if not exists hourly_pay numeric(10,2) not null default 0;
alter table teachers add column if not exists pay_currency text not null default 'PHP';

alter table lessons add column if not exists pay_rate numeric(10,2);
alter table lessons add column if not exists pay_amount numeric(10,2);

create index if not exists idx_lessons_teacher_month
  on lessons (teacher_id, scheduled_at) where status = 'completed';

-- 课酬结算视图: 按老师 + 月份聚合已完成课节
create or replace view teacher_payroll as
  select
    t.profile_id                                        as teacher_id,
    p.full_name                                         as teacher_name,
    date_trunc('month', l.scheduled_at)::date           as month,
    count(l.id)                                         as lessons_done,
    coalesce(sum(l.duration_min), 0)                     as minutes_done,
    coalesce(sum(coalesce(l.pay_amount, l.pay_rate * l.duration_min / 60.0)), 0)::numeric(12,2) as pay_amount
  from teachers t
  join profiles p on p.id = t.profile_id
  join lessons l on l.teacher_id = t.profile_id and l.status = 'completed'
  group by t.profile_id, p.full_name, date_trunc('month', l.scheduled_at);

comment on view teacher_payroll is '按老师+月份统计已完成课节与课酬; pay_amount 优先取快照, 缺失时按 pay_rate*时长折算';
