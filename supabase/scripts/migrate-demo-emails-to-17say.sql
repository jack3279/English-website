-- 可选: 把现有 demo user 的 email 从 @demo.local 改到 @17say.org 品牌对齐
-- 在 Supabase SQL Editor 跑一次, 幂等 (已改过会跳过)
-- 注意: 改 auth.users.email 不会自动更新 auth.identities, 用户登录用 email 时两者都要匹配
-- 改完后, LoginPage 默认值已经显示 admin@17say.org 等, e2e 测试需要从 admin@demo.local 改到 admin@17say.org

DO $$
DECLARE
  mapping TEXT[][] := ARRAY[
    ['admin@demo.local',     'admin@17say.org'],
    ['emma@demo.local',      'emma@17say.org'],
    ['john@demo.local',      'john@17say.org'],
    ['lilyparent@demo.local','lilyparent@17say.org'],
    ['tomparent@demo.local', 'tomparent@17say.org'],
    ['aliceparent@demo.local','aliceparent@17say.org'],
    ['bobparent@demo.local', 'bobparent@17say.org']
  ];
  old_email TEXT;
  new_email TEXT;
  uid UUID;
  affected INT := 0;
BEGIN
  FOR i IN 1..array_length(mapping, 1) LOOP
    old_email := mapping[i][1];
    new_email := mapping[i][2];
    SELECT id INTO uid FROM auth.users WHERE email = old_email;
    IF uid IS NOT NULL THEN
      UPDATE auth.users SET email = new_email, email_confirmed_at = now() WHERE id = uid;
      UPDATE auth.identities
        SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(new_email))
        WHERE user_id = uid AND provider = 'email';
      affected := affected + 1;
      RAISE NOTICE 'updated % -> % (id=%)', old_email, new_email, uid;
    END IF;
  END LOOP;
  RAISE NOTICE 'total updated: %', affected;
END $$;

-- 验证
SELECT email, raw_user_meta_data->>'role' AS role
FROM auth.users
WHERE email LIKE '%@17say.org' OR email LIKE '%@demo.local'
ORDER BY email;
