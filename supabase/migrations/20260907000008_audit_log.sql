create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references profiles on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  payload jsonb,
  req_id text,
  created_at timestamptz not null default now()
);

create index idx_audit_actor_time on audit_log (actor, created_at desc);
create index idx_audit_target on audit_log (target_type, target_id);
