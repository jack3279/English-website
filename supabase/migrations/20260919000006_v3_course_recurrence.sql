-- v3: 课程模板补齐 recurrence / 起止日期 / 腾讯会议链接
-- A 版的 courses 是"规律课模板", B 版 courses 已有 weekday + start_time,
-- 这里补齐 recurrence 频次、生效区间与会议链接, 便于自动生成课节与冲突检测。
-- Idempotent

alter table courses add column if not exists recurrence text not null default 'weekly';
alter table courses add column if not exists start_date date;
alter table courses add column if not exists end_date date;
alter table courses add column if not exists meeting_url text;
alter table courses add column if not exists room text;

create index if not exists idx_courses_active_range on courses (active, start_date, end_date);

-- 课节上冗余一份会议链接: 生成课节时从课程模板拷贝, 之后改模板不影响已生成课节
alter table lessons add column if not exists meeting_url text;

comment on column courses.recurrence is 'weekly|biweekly|monthly|once|none';
