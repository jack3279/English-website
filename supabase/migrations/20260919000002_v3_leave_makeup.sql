-- v3: 请假审批 + 补课单
-- leave_status 枚举 (pending/approved/rejected) 已在 20260907000001 建好, 直接复用
-- Idempotent

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  lesson_id uuid references lessons on delete set null,
  requested_by uuid not null references profiles on delete cascade,
  reason text,
  status leave_status not null default 'pending',
  reviewed_by uuid references profiles on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leave_student on leave_requests (student_id, created_at desc);
create index if not exists idx_leave_status on leave_requests (status, created_at desc);
create index if not exists idx_leave_lesson on leave_requests (lesson_id);

drop trigger if exists trg_leave_requests_updated_at on leave_requests;
create trigger trg_leave_requests_updated_at
  before update on leave_requests
  for each row execute function set_updated_at();


create table if not exists makeups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  leave_request_id uuid references leave_requests on delete set null,
  original_lesson_id uuid references lessons on delete set null,
  makeup_lesson_id uuid references lessons on delete set null,
  scheduled_at timestamptz,
  duration_min int default 60,
  status text not null default 'pending',
  note text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_makeups_student on makeups (student_id, created_at desc);
create index if not exists idx_makeups_status on makeups (status, scheduled_at);

drop trigger if exists trg_makeups_updated_at on makeups;
create trigger trg_makeups_updated_at
  before update on makeups
  for each row execute function set_updated_at();

comment on column makeups.status is 'pending|scheduled|done|cancelled';
