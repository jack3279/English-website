-- v3: 站内通知中心
-- 通知发给谁: target_user 定向 > target_role 角色广播 > 两者都空 = 全员
-- 已读状态单独一张 notification_reads: 多条已读一次 INSERT 搞定,
-- 避免 read_by uuid[] 的 read-modify-write (Workers 免费档子请求只有 50/请求)
-- Idempotent

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'system',
  title text not null,
  body text,
  target_user uuid references profiles on delete cascade,
  target_role user_role,
  student_id uuid references students on delete cascade,
  link text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists notification_reads (
  user_id uuid not null references profiles on delete cascade,
  notification_id uuid not null references notifications on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);

create index if not exists idx_notification_reads_user on notification_reads (user_id);

create index if not exists idx_notifications_created
  on notifications (created_at desc);
create index if not exists idx_notifications_target_user
  on notifications (target_user, created_at desc);
create index if not exists idx_notifications_target_role
  on notifications (target_role, created_at desc);
create index if not exists idx_notifications_student
  on notifications (student_id);

comment on table notifications is '站内通知; type: lesson_reminder|class_report|renewal|leave|makeup|system';
