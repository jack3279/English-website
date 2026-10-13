create table records (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons on delete cascade unique,
  content text not null,
  performance text,
  homework text,
  next_plan text,
  created_by uuid not null references profiles on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_records_lesson on records (lesson_id);

-- 课时流水 append-only
create table lesson_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete restrict,
  lesson_id uuid references lessons on delete set null,
  delta numeric(6,2) not null,
  reason lesson_tx_reason not null,
  note text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index idx_lt_student on lesson_transactions (student_id, created_at desc);
create index idx_lt_lesson on lesson_transactions (lesson_id);

-- 余额视图
create or replace view student_balance as
  select
    s.id as student_id,
    coalesce(sum(lt.delta), 0)::numeric(10,2) as remaining_hours
  from students s
  left join lesson_transactions lt on lt.student_id = s.id
  group by s.id;
