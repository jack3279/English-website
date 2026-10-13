-- v3: 公告
-- audience 为空 = 全员可见; 填角色 = 仅该角色可见
-- Idempotent

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience user_role,
  branch_id uuid references branches on delete cascade,
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_announcements_pub
  on announcements (published_at desc);
create index if not exists idx_announcements_audience
  on announcements (audience, published_at desc);
