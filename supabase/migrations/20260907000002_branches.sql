create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_branches_code on branches (code);

-- seed demo 校区
insert into branches (id, name, code)
values ('00000000-0000-0000-0000-000000000001', '总部校区', 'HQ')
on conflict do nothing;
