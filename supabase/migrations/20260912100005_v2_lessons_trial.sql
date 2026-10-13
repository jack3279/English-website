-- v2 stage 1: lessons trial 扩展 + lesson_transactions.student_package_id
-- Idempotent

alter table lessons add column if not exists is_trial boolean default false;
alter table lessons add column if not exists trial_parent_name text;
alter table lessons add column if not exists trial_parent_phone text;

alter table lesson_transactions add column if not exists student_package_id uuid references student_packages;
create index if not exists idx_lesson_tx_pkg on lesson_transactions(student_package_id);
