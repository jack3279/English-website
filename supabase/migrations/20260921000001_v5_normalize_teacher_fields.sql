-- v5: 归一位于 teachers 上的两个历史遗留字段
--
-- 背景（教师管理页曾显示「?」姓名、原始 JSON 专长、课酬数字对不上）：
--
-- 1) hourly_pay 是 20260919000005 新增的「课酬单价(元/小时)」显式字段，迁移注释里已写明
--    default_rate 是历史字段、单位存疑、不用于结算。但老数据只写在 default_rate 里，
--    且两种写法混存：
--       - seed-users.mjs 写的是「元」     (200)
--       - seed-demo-data.sql 写的是「分」(25000 / 30000 / 22000)
--    用 10000 作分界回填：< 10000 视为元；>= 10000 视为分 → 除以 100。
--    **只回填 hourly_pay 仍为 0 的行，不覆盖已显式设置的值。**
--
-- 2) specialties 是 text 列，历史混存 '["kids","phonics"]' 与 "ESL, Phonics" 两种写法，
--    直接吐给前端会把引号/方括号渲染进标签。统一成「逗号 + 空格」分隔的文本。
--
-- 幂等：可重复执行。

-- ── 1. 回填 hourly_pay ──────────────────────────────────────────
update teachers
set hourly_pay = case
  when default_rate >= 10000 then round(default_rate / 100, 2)
  else default_rate
end
where coalesce(hourly_pay, 0) = 0
  and coalesce(default_rate, 0) > 0;

-- ── 2a. JSON 数组形态 -> 逗号串 ────────────────────────────────
-- 用正则先确认「形如 ["a","b"]」，避免对非法 JSON 直接 ::jsonb 抛错
update teachers
set specialties = (
  select string_agg(trim(elem), ', ' order by ord)
  from jsonb_array_elements_text(specialties::jsonb) with ordinality as t(elem, ord)
  where trim(elem) <> ''
)
where specialties ~ '^\s*\[\s*".*"\s*\]\s*$';

-- 空数组 `[]` 视为无专长
update teachers
set specialties = null
where specialties ~ '^\s*\[\s*\]\s*$';

-- ── 2b. 其余形态：统一分隔符为「逗号 + 空格」────────────────────
update teachers
set specialties = nullif(
  array_to_string(
    array(
      select trim(x)
      from unnest(regexp_split_to_array(specialties, '\s*[,，、]\s*')) as x
      where trim(x) <> ''
    ),
    ', '
  ),
  ''
)
where specialties is not null
  and specialties <> ''
  and specialties !~ '^\s*\[';
