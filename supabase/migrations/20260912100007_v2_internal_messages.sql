-- v2 stage 1: internal_messages 表 (站内信)
-- Idempotent

create table if not exists internal_messages (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references profiles on delete cascade,
  subject text,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_internal_messages_to on internal_messages(to_user, read_at);
