-- v4: 企业微信身份绑定
-- 老师 = 机构内部成员 -> 走「应用消息」(message/send), 用 teachers.wecom_user_id
-- 家长 = 外部联系人   -> 走「客户联系」(externalcontact/message/send), 用 students.wecom_external_user_id
--
-- 为什么企微 ID 放在 students 而不是 parents:
--   实际场景是「一个学员对应一位主要监护人」，且 B 版目前没有家长管理界面；
--   放在 students 上可以直接复用现有的学员编辑弹窗录入，零新增 UI。
--   与 A 版口径一致 (A 版也是 student.wecomExternalUserId)，便于历史数据直接搬。
--   将来若要支持「一位学员绑定多位家长」，再给 parents 加同名字段并优先取家长级即可。
--
-- 字段留空表示未绑定, 发送时优雅跳过 (不报错、不影响主流程)
-- Idempotent

alter table teachers add column if not exists wecom_user_id text;
alter table students add column if not exists wecom_external_user_id text;

create index if not exists idx_teachers_wecom on teachers (wecom_user_id) where wecom_user_id is not null;
create index if not exists idx_students_wecom on students (wecom_external_user_id) where wecom_external_user_id is not null;

comment on column teachers.wecom_user_id is '企业微信成员 UserID (机构内部, 应用消息收件人)';
comment on column students.wecom_external_user_id is '家长企业微信外部联系人 ID (客户联系消息收件人)';
