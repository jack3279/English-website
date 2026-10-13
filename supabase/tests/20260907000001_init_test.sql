-- pgTAP 基础检查：9 张表都建出来了
begin;
select plan(9);

select has_table('public', 'branches', 'branches exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'students', 'students exists');
select has_table('public', 'parents', 'parents exists');
select has_table('public', 'parent_student_links', 'parent_student_links exists');
select has_table('public', 'courses', 'courses exists');
select has_table('public', 'lessons', 'lessons exists');
select has_table('public', 'records', 'records exists');
select has_table('public', 'lesson_transactions', 'lesson_transactions exists');

select * from finish();
rollback;
