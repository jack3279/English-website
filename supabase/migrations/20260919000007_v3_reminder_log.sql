-- v3: 定时任务的幂等标记表
-- Workers Cron 可能重复触发 / 重跑, 用 dedupe_key 唯一约束保证同一条提醒只发一次
-- 只有 service_role 会写 (无 RLS policy = 普通用户全 deny)
-- Idempotent

create table if not exists reminder_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  channel text,
  payload jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists idx_reminder_kind_time on reminder_log (kind, sent_at desc);

comment on column reminder_log.kind is 'lesson_reminder|renewal|keepalive|backup';
