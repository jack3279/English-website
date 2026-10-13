// 时间窗口工具。全站统一口径：业务日期按 Asia/Shanghai(+08:00) 解释。
//
// 为什么要单独收口：Workers 跑在 UTC 上，直接用 new Date(y, m, 1) 取的是
// **运行环境的本地月首**，于是每月 1 号 0-8 点之间「本月」会算成上个月。
// 财务、报告、运营待办三处都要用同一套口径，各写一份必然长歪。

const SHANGHAI = 8 * 3600 * 1000;

// 返回「上海时间当月 1 号 00:00」对应的 UTC 时刻。offsetMonths 可为负。
function monthStartIso(offsetMonths = 0) {
  const s = new Date(Date.now() + SHANGHAI); // 平移后可用 getUTC* 读上海墙钟
  const iso = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + offsetMonths, 1) - SHANGHAI;
  return new Date(iso).toISOString();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// from/to 都是**本地日历日**, to 含当天。返回 { fromIso, toIso, from, to }。
// 传 null 表示「不限」。出错时返回 { bad: "文案" }。
function parseWindow(from, to) {
  if (from && !DATE_RE.test(from)) return { bad: "from 应为 YYYY-MM-DD" };
  if (to && !DATE_RE.test(to)) return { bad: "to 应为 YYYY-MM-DD" };
  // 正则只校验形状, 2026-13-01 这种照样过 —— 必须用 Date 再验一次,
  // 否则 toISOString() 会抛 RangeError, 400 变成 500。
  const fromMs = from ? Date.parse(`${from}T00:00:00+08:00`) : null;
  const toMs = to ? Date.parse(`${to}T23:59:59.999+08:00`) : null;
  if (fromMs !== null && Number.isNaN(fromMs)) return { bad: "from 不是有效日期" };
  if (toMs !== null && Number.isNaN(toMs)) return { bad: "to 不是有效日期" };
  const fromIso = fromMs === null ? null : new Date(fromMs).toISOString();
  const toIso = toMs === null ? null : new Date(toMs).toISOString();
  if (fromIso && toIso && fromIso > toIso) return { bad: "from 不能晚于 to" };
  return { fromIso, toIso, from: from || null, to: to || null };
}

// 把窗口套到 supabase 查询构造器的字段上（不传就是不限）。
function applyWindow(q, field, fromIso, toIso) {
  let r = q;
  if (fromIso) r = r.gte(field, fromIso);
  if (toIso) r = r.lte(field, toIso);
  return r;
}

// 解析「有效期」。接受 YYYY-MM-DD 或完整 ISO。
// 纯日期按**当天结束**（+08:00 的 23:59:59.999）解释 —— 否则「有效期到 12-31」
// 会被理解成 12-31 00:00，家长 12-31 白天来上课就发现已经过期了。
// 无效格式返回 { bad }，由调用方转成 400（不要让它冒到 toISOString 抛 RangeError）。
function parseExpiresAt(raw) {
  if (raw === null || raw === undefined || raw === "") return { iso: null };
  const s = String(raw).trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59.999+08:00`) : Date.parse(s);
  if (Number.isNaN(ms)) return { bad: "有效期格式不正确" };
  return { iso: new Date(ms).toISOString() };
}

// 把「月份/日期」入参归一化成 YYYY-MM-DD，用于和 date 类型的 month 列比较。
// 接受: YYYY-MM(取该月 1 号) / YYYY-MM-DD / 带时间的完整 ISO(取日期部分)。
// 空值 -> { value: null }(不限)；无法识别返回 { bad }，由调用方转 400。
function normalizeMonthParam(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { value: null };
  const s = String(raw).trim();
  let d;
  if (/^\d{4}-\d{2}$/.test(s)) d = `${s}-01`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = s;
  else {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})T/); // 完整 ISO -> 只取日期部分
    if (!m) return { bad: "月份格式应为 YYYY-MM 或 YYYY-MM-DD" };
    d = m[1];
  }
  // 正则只校验形状, 2026-13 / 02-31 仍要靠 Date 拦下来, 否则会在库里报错变 500。
  if (Number.isNaN(Date.parse(`${d}T00:00:00+08:00`))) return { bad: "月份不是有效日期" };
  return { value: d };
}

// 用于「按月聚合」视图（teacher_payroll.month 存的是每月 1 号）：
// 把已归一化的 YYYY-MM-DD 归到所在月 1 号。
// 否则 from 为月中（如「近 90 天」起点 2026-07-07）时，month=2026-07-01 < from，
// 起始月整桶被漏掉。月桶无法拆分，纳入整个重叠月是唯一一致口径。
function floorToMonthStart(dateStr) {
  if (!dateStr) return null;
  return `${String(dateStr).slice(0, 7)}-01`;
}

// 把时间显示成「上海时间 9/23 16:00」。通知正文里要给人看，不能塞 ISO。
function fmtWhenShanghai(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

module.exports = {
  SHANGHAI,
  monthStartIso,
  parseWindow,
  applyWindow,
  parseExpiresAt,
  normalizeMonthParam,
  floorToMonthStart,
  fmtWhenShanghai,
};
