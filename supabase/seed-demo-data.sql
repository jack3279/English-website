-- 一站式 demo data: 3 教师 + 2 家长 + 2 学生 + 5 排课 + 1 已完课反馈
-- 在 Supabase SQL Editor 跑一次。
-- ⚠️ 仅用于「全新环境」：线上（2026-09-21 起）已有真实数据（16 学员 / 5 教师 / 73 课节），
--    重复跑会造重复记录；需要账号时用 supabase/scripts/seed-users.mjs（幂等建号）。
-- 注：本机与 supabase.co 连通性正常，"跑不了"是早期误判，见 .workbuddy/memory/MEMORY.md 第 4 节第 7 条。
-- Idempotent: 重复跑会跳过已存在 records

-- ===== 1. 教师 users (auth.users) =====
-- supabase auth.users 不能直接 INSERT (trigger), 用 auth.admin.createUser via Supabase Dashboard > Authentication
-- 或者复制到 SQL 后手跑:
--   admin@17say.org / Demo1234! 已经有, 跳过
--   手动用 Dashboard > Auth > Users > Add user 创建 3 个 teacher + 2 个 parent, email_confirm=true:
--     alice.t@17say.org / Demo1234!  (Teacher)
--     bob.t@17say.org   / Demo1234!  (Teacher)
--     carol.t@17say.org / Demo1234!  (Teacher)
--     david.p@17say.org / Demo1234! (Parent)
--     emma.p@17say.org  / Demo1234! (Parent)
-- 然后跑下面 SQL 写 profiles + teachers/parents + students + lessons.

-- ===== 2. profiles (必须先有 auth.users) =====
insert into profiles (id, full_name, role, branch_id, phone) values
  ((select id from auth.users where email = 'alice.t@17say.org'), 'Alice 老师', 'teacher', '00000000-0000-0000-0000-000000000001', '13800001001'),
  ((select id from auth.users where email = 'bob.t@17say.org'),   'Bob 老师',   'teacher', '00000000-0000-0000-0000-000000000001', '13800001002'),
  ((select id from auth.users where email = 'carol.t@17say.org'), 'Carol 老师', 'teacher', '00000000-0000-0000-0000-000000000001', '13800001003'),
  ((select id from auth.users where email = 'david.p@17say.org'), 'David 爸爸', 'parent',  '00000000-0000-0000-0000-000000000001', '13800002001'),
  ((select id from auth.users where email = 'emma.p@17say.org'),  'Emma 妈妈',  'parent',  '00000000-0000-0000-0000-000000000001', '13800002002')
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

-- ===== 3. teachers =====
-- specialties 是 text 列, 存「逗号分隔」; 课酬用 hourly_pay(元/小时), 不用历史字段 default_rate
insert into teachers (profile_id, specialties, hourly_pay, active) values
  ((select id from auth.users where email = 'alice.t@17say.org'), 'kids, beginner', 250, true),
  ((select id from auth.users where email = 'bob.t@17say.org'),   'teens, business', 300, true),
  ((select id from auth.users where email = 'carol.t@17say.org'), 'kids, phonics', 220, true)
on conflict (profile_id) do nothing;

-- ===== 4. parents =====
insert into parents (profile_id, full_name) values
  ((select id from auth.users where email = 'david.p@17say.org'), 'David 爸爸'),
  ((select id from auth.users where email = 'emma.p@17say.org'),  'Emma 妈妈')
on conflict (profile_id) do nothing;

-- ===== 5. students =====
insert into students (full_name, birth_date, branch_id, status) values
  ('David Jr', '2017-06-15', '00000000-0000-0000-0000-000000000001', 'active'),
  ('Emma Jr',  '2017-06-15', '00000000-0000-0000-0000-000000000001', 'active')
on conflict do nothing;

-- ===== 6. parent_student_links (composite PK: parent_id, student_id) =====
insert into parent_student_links (parent_id, student_id, relation) values
  (
    (select id from parents where profile_id = (select id from auth.users where email = 'david.p@17say.org')),
    (select id from students where full_name = 'David Jr'),
    'guardian'
  ),
  (
    (select id from parents where profile_id = (select id from auth.users where email = 'emma.p@17say.org')),
    (select id from students where full_name = 'Emma Jr'),
    'guardian'
  )
on conflict (parent_id, student_id) do nothing;

-- ===== 7. 5 lessons =====
-- Lesson 1: 已完课 (含 feedback, 已 publish 到 parent_feed)
insert into lessons (teacher_id, student_id, scheduled_at, duration_min, status, completed_at) values
  (
    (select id from teachers where profile_id = (select id from auth.users where email = 'alice.t@17say.org')),
    (select id from students where full_name = 'David Jr'),
    now() - interval '1 day',
    60,
    'completed',
    now() - interval '1 day' + interval '55 minutes'
  );

-- Record for completed lesson
insert into records (lesson_id, content, performance, homework, next_plan, created_by) values
  (
    (select id from lessons where student_id = (select id from students where full_name = 'David Jr') and status = 'completed' order by scheduled_at desc limit 1),
    '学生表现活跃，积极举手发言',
    'excellent',
    '复习 Lesson 3 单词表，抄写 3 遍',
    'Lesson 4 继续练习现在进行时',
    (select id from profiles where full_name = 'Alice 老师')
  );

-- Lesson transactions (consume -1h for 60 min lesson)
insert into lesson_transactions (student_id, lesson_id, delta, reason, note, created_by) values
  (
    (select id from students where full_name = 'David Jr'),
    (select id from lessons where student_id = (select id from students where full_name = 'David Jr') and status = 'completed' order by scheduled_at desc limit 1),
    -1,
    'consume',
    'Lesson 3 - 学生回答问题 12 次，跟读 5 次',
    (select id from profiles where full_name = 'Alice 老师')
  );

-- Parent feed (published to parent)
insert into parent_feeds (student_id, record_id, summary, published_at) values
  (
    (select id from students where full_name = 'David Jr'),
    (select id from records where content = '学生表现活跃，积极举手发言' limit 1),
    'Lesson 3 - 学生回答问题 12 次，跟读 5 次',
    now() - interval '1 day' + interval '1 hour'
  );

-- Lesson 2-5: 4 future lessons (scheduled)
insert into lessons (teacher_id, student_id, scheduled_at, duration_min, status) values
  (
    (select id from teachers where profile_id = (select id from auth.users where email = 'alice.t@17say.org')),
    (select id from students where full_name = 'David Jr'),
    now() + interval '4 hours',
    60,
    'scheduled'
  ),
  (
    (select id from teachers where profile_id = (select id from auth.users where email = 'bob.t@17say.org')),
    (select id from students where full_name = 'Emma Jr'),
    now() + interval '1 day' + interval '10 hours',
    60,
    'scheduled'
  ),
  (
    (select id from teachers where profile_id = (select id from auth.users where email = 'alice.t@17say.org')),
    (select id from students where full_name = 'David Jr'),
    now() + interval '2 days' + interval '15 hours' + interval '30 minutes',
    60,
    'scheduled'
  ),
  (
    (select id from teachers where profile_id = (select id from auth.users where email = 'carol.t@17say.org')),
    (select id from students where full_name = 'Emma Jr'),
    now() + interval '3 days' + interval '9 hours',
    60,
    'scheduled'
  );

-- ===== 8. 验证 =====
select 'teachers' as label, count(*) from teachers
union all select 'parents', count(*) from parents
union all select 'students', count(*) from students
union all select 'lessons', count(*) from lessons
union all select 'records', count(*) from records
union all select 'lesson_transactions', count(*) from lesson_transactions
union all select 'parent_feeds', count(*) from parent_feeds;
