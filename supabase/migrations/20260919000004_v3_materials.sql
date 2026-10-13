-- v3: 学习内容 / 教材
-- 文件本体存 R2 (出网免费) 或 Supabase Storage, 表里只存 url / storage_path
-- student_id 为空 = 通用教材; 有值 = 发给该学员
-- Idempotent

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  student_id uuid references students on delete cascade,
  course_id uuid references courses on delete set null,
  kind text not null default 'file',
  url text,
  storage_path text,
  content text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_materials_student on materials (student_id, created_at desc);
create index if not exists idx_materials_course on materials (course_id);

comment on column materials.kind is 'file|link|text';
