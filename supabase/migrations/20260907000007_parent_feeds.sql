create table parent_feeds (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records on delete cascade unique,
  student_id uuid not null references students on delete cascade,
  summary text not null,
  published_at timestamptz not null default now()
);

create index idx_parent_feeds_student_pub
  on parent_feeds (student_id, published_at desc);
