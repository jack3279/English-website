create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birth_date date,
  branch_id uuid references branches on delete set null,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create index idx_students_branch on students (branch_id);
create index idx_students_status on students (status);

create table parents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade unique,
  full_name text not null,
  created_at timestamptz not null default now()
);

create index idx_parents_profile on parents (profile_id);

create table parent_student_links (
  parent_id uuid not null references parents on delete cascade,
  student_id uuid not null references students on delete cascade,
  relation text not null default 'guardian',
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

create index idx_psl_student on parent_student_links (student_id);
