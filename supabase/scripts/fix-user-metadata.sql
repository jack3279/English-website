-- 在 Supabase SQL Editor 一次跑完 (项目 ueuerggzomryvisijdym)
-- 1. 7 个 demo user 补 role + branch_id + phone 到 user_metadata
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"admin","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13800000001"}'::jsonb WHERE id = 'a7681e68-a783-4132-9013-dc3974a2d42b';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"teacher","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13800000002"}'::jsonb WHERE id = '30ed158b-3700-49f3-8241-3dcfed5a3950';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"teacher","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13800000003"}'::jsonb WHERE id = 'ff9b0941-e395-4fb0-a579-6a00123030e4';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"parent","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13800000004"}'::jsonb WHERE id = 'ed770b6d-abeb-4779-83a3-4bbc8c358548';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"parent","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13900000001"}'::jsonb WHERE id = 'a32a7d8a-a40f-4da1-834e-7280a8bceb24';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"parent","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13900000002"}'::jsonb WHERE id = 'bd5e2234-84e9-4e89-9362-1c4961805352';
UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"parent","branch_id":"00000000-0000-0000-0000-000000000001","phone":"13900000003"}'::jsonb WHERE id = 'ad5b42f5-7045-4cbd-833f-4ad0b0574cc6';
-- 2. 验证
SELECT id, raw_user_meta_data->>'role' AS role, raw_user_meta_data->>'phone' AS phone FROM auth.users WHERE id IN (
  'a7681e68-a783-4132-9013-dc3974a2d42b',
  '30ed158b-3700-49f3-8241-3dcfed5a3950',
  'ff9b0941-e395-4fb0-a579-6a00123030e4',
  'ed770b6d-abeb-4779-83a3-4bbc8c358548',
  'a32a7d8a-a40f-4da1-834e-7280a8bceb24',
  'bd5e2234-84e9-4e89-9362-1c4961805352',
  'ad5b42f5-7045-4cbd-833f-4ad0b0574cc6'
) ORDER BY raw_user_meta_data->>'role';
