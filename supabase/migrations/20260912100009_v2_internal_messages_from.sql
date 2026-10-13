-- v2 stage 3.2: internal_messages 加 from_user 字段 + 索引
-- 之前只 to_user, 无法知道发件人是谁
-- Idempotent

alter table internal_messages
  add column if not exists from_user uuid references profiles on delete set null;

create index if not exists idx_internal_messages_from on internal_messages(from_user);
create index if not exists idx_internal_messages_inbox on internal_messages(to_user, read_at, created_at desc);
