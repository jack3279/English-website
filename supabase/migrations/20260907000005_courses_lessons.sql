create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid not null references profiles on delete restrict,
  branch_id uuid references branches on delete set null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_min int not null default 60 check (duration_min > 0),
  student_id uuid references students on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_courses_teacher on courses (teacher_id);
create index idx_courses_student on courses (student_id);
create index idx_courses_branch on courses (branch_id);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses on delete set null,
  teacher_id uuid not null references profiles on delete restrict,
  student_id uuid not null references students on delete restrict,
  scheduled_at timestamptz not null,
  duration_min int not null default 60,
  status lesson_status not null default 'scheduled',
  completed_at timestamptz,
  leave_status leave_status,
  leave_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lessons_teacher_scheduled on lessons (teacher_id, scheduled_at);
create index idx_lessons_student_scheduled on lessons (student_id, scheduled_at);
create index idx_lessons_status on lessons (status);

create trigger trg_lessons_updated_at
  before update on lessons
  for each row execute function set_updated_at();
