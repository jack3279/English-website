-- v2 stage 1: leads 表 (公开提交, 招生用)
-- Idempotent

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null,
  parent_phone text not null,
  child_name text,
  child_age int,
  preferred_time text,
  notes text,
  status lead_status not null default 'new',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  assigned_to uuid references profiles
);
create index if not exists idx_leads_status on leads(status, created_at desc);

-- updated_at 自动维护
create or replace function leads_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
  before update on leads
  for each row execute function leads_set_updated_at();
