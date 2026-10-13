-- 清理所有测试数据（__SMOKE__ / E2E- / Toast-E2E- / verify- 前缀）。
-- 在 Supabase Dashboard → SQL Editor 整段执行；幂等，重复运行安全。
-- 真实学员（Alice/Bob/Carol/David/David Jr/Emma Jr/Lily/Mia/Tom）不在匹配范围内，不会被删。

BEGIN;

-- 测试学员集合（统一口径，下面各 DELETE 复用）
-- 用临时表存 id，避免反复写字串匹配，也保证删的是同一批。
CREATE TEMP TABLE _test_students ON COMMIT DROP AS
SELECT id FROM students
WHERE full_name ~ '^(__SMOKE__|E2E-|Toast-E2E-|verify-)';

-- 1) 通知已读 → 通知（含发给真实管理员、正文带标记的测试通知）
DELETE FROM notification_reads nr
WHERE nr.notification_id IN (
  SELECT id FROM notifications
  WHERE student_id IN (SELECT id FROM _test_students)
     OR title ~ '__SMOKE__' OR body ~ '__SMOKE__'
);
DELETE FROM notifications
WHERE student_id IN (SELECT id FROM _test_students)
   OR title ~ '__SMOKE__' OR body ~ '__SMOKE__';

-- 2) 缴费 / 课时流水
DELETE FROM package_payments  WHERE student_id IN (SELECT id FROM _test_students);
DELETE FROM lesson_transactions WHERE student_id IN (SELECT id FROM _test_students);

-- 3) 家长动态
DELETE FROM parent_feeds WHERE student_id IN (SELECT id FROM _test_students);

-- 4) 课后记录（挂在课节下，先删记录）
DELETE FROM records WHERE lesson_id IN (
  SELECT id FROM lessons WHERE student_id IN (SELECT id FROM _test_students)
);

-- 5) 补课 → 请假
DELETE FROM makeups        WHERE student_id IN (SELECT id FROM _test_students);
DELETE FROM leave_requests WHERE student_id IN (SELECT id FROM _test_students);

-- 6) 课节
DELETE FROM lessons WHERE student_id IN (SELECT id FROM _test_students);

-- 7) 学员课时包 / 教材
DELETE FROM student_packages WHERE student_id IN (SELECT id FROM _test_students);
DELETE FROM materials       WHERE student_id IN (SELECT id FROM _test_students);

-- 8) 家长-学员关联（如有），再删学员
DELETE FROM parent_student_links WHERE student_id IN (SELECT id FROM _test_students);

-- 9) 按名称标记的独立测试对象：课程模板 / 课时包类型 / 线索 / 站内信
DELETE FROM courses           WHERE name ~ '^__SMOKE__';
DELETE FROM package_types     WHERE name ~ '^__SMOKE__';
DELETE FROM leads             WHERE parent_name ~ '^__SMOKE__';
DELETE FROM internal_messages WHERE subject ~ '^__SMOKE__' OR body ~ '__SMOKE__';

-- 10) 测试学员
DELETE FROM students WHERE id IN (SELECT id FROM _test_students);

COMMIT;

-- 结果确认：应只剩真实学员
SELECT full_name FROM students ORDER BY full_name;
