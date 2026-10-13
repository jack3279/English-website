-- v6: 招生线索补齐「意向课程」「期望试听日期」
--
-- 背景：家长在 /recruit 提交试听报名时只能填方便联系的时间，
-- 教务回电时每次都要重新问一遍「孩子想上什么课」「希望哪天来试听」，
-- 这两个字段在线索列表里也看不到，回访全靠人工翻备注。
--
-- leads.preferred_time 原本是「方便联系时间」（自由文本/下拉），本次**不改**它的语义，
-- 另加两个语义明确的字段：
--   intended_course text  —— 意向课程（少儿口语 / 自然拼读 / 剑桥备考 / …）
--   trial_date      date  —— 期望试听日期（家长在表单上选的那天）
--
-- 幂等：可重复执行。

alter table leads add column if not exists intended_course text;
alter table leads add column if not exists trial_date date;

-- 线索列表按状态 + 时间排序，把期望试听日期一并进索引，
-- 「今天/明天有谁约了试听」这类查询不用全表扫。
create index if not exists idx_leads_trial_date on leads(trial_date)
  where trial_date is not null;

comment on column leads.intended_course is '意向课程方向，如：少儿口语 / 自然拼读 / 剑桥备考';
comment on column leads.trial_date is '家长期望的试听日期（本地日历日，无时区语义）';
