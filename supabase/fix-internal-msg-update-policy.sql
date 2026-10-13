-- ⚠️ 已固化进 supabase/migrations/20260922000001_v6_consolidate_loose_fixes.sql ——
--    按 migrations 从零建库也会包含本文件内容。这里保留仅为历史参考，
--    改动请改迁移文件，不要只改这里。
-- 修复: internal_messages 加 UPDATE policy (用户只能标记自己的消息已读)
-- 之前只有 SELECT + INSERT policy, 缺 UPDATE → emma mark-read 被 RLS 拒
-- 但 service_role 应 bypass. 如果 service_role 也返 null, 可能是 schema cache

alter table internal_messages enable row level security;

drop policy if exists "internal_msg_mark_read" on internal_messages;
create policy "internal_msg_mark_read" on internal_messages
  for update to authenticated
  using (to_user = auth.uid())
  with check (to_user = auth.uid());

-- 加 service_role bypass: 实际上 service_role 默认 bypass RLS,
-- 之前 .update() 返 null 可能是 schema cache 缺 read_at 字段
-- 强制 schema reload:
notify pgrst, 'reload schema';