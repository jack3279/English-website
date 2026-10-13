-- v2 stage 1: package_types + student_packages + package_payments
-- Idempotent: 全部 if not exists 保护, 可重跑

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum ('new', 'contacted', 'trial_scheduled', 'converted', 'lost');
  end if;
end $$;

create table if not exists package_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hours numeric(6,2) not null check (hours > 0),
  price_cents int not null check (price_cents >= 0),
  active boolean default true,
  created_at timestamptz default now()
);

create unique index if not exists idx_package_types_name on package_types(name);

create table if not exists student_packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  package_type_id uuid references package_types,
  total_hours numeric(6,2) not null,
  remaining_hours numeric(6,2) not null,
  purchased_at timestamptz default now(),
  expires_at timestamptz,
  notes text
);
create index if not exists idx_student_packages_student on student_packages(student_id);
create index if not exists idx_student_packages_remaining on student_packages(remaining_hours);

create table if not exists package_payments (
  id uuid primary key default gen_random_uuid(),
  student_package_id uuid references student_packages,
  student_id uuid not null references students,
  amount_cents int not null,
  method text,
  paid_at timestamptz default now(),
  recorded_by uuid not null references profiles,
  notes text
);
create index if not exists idx_payments_student on package_payments(student_id);
create index if not exists idx_payments_package on package_payments(student_package_id);
