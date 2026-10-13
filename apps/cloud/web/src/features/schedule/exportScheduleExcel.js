// 排课数据导出 Excel —— 前端用 xlsx (SheetJS) 生成, 后端零改动
// 支持三种视图: 周视图(整周) / 老师视图(单日) / 学员视图(单日)
// 列: 日期 / 星期 / 开始时间 / 结束时间 / 时长(分钟) / 状态 / 学员 / 老师 / 备注

import * as XLSX from "xlsx";

const STATUS_LABEL = {
  scheduled: "已排",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "缺席",
};

const PAD2 = (n) => String(n).padStart(2, "0");

function fmtDate(d) {
  return `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`;
}
function fmtTime(d) {
  return `${PAD2(d.getHours())}:${PAD2(d.getMinutes())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${fmtTime(d)}`;
}
function weekdayCN(d) {
  return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
}

/**
 * 把 lessons 数组整理成 sheet-ready 二维数组
 */
function buildRows(lessons, viewMode, anchor, weekMode) {
  // 排序: 日期升序 + 时间升序
  const sorted = [...lessons].sort((a, b) => {
    const ta = new Date(a.scheduled_at).getTime();
    const tb = new Date(b.scheduled_at).getTime();
    return ta - tb;
  });

  const rows = [["日期", "星期", "开始", "结束", "时长(分钟)", "状态", "学员", "老师", "备注"]];

  for (const l of sorted) {
    const start = new Date(l.scheduled_at);
    const dur = Number(l.duration_min || 60);
    const end = new Date(start.getTime() + dur * 60_000);
    rows.push([
      fmtDate(start),
      `周${weekdayCN(start)}`,
      fmtTime(start),
      fmtTime(end),
      dur,
      STATUS_LABEL[l.status] || l.status || "",
      l.students?.full_name || "",
      l.profiles?.full_name || "",
      l.notes || "",
    ]);
  }

  // 末尾汇总: 当周/当日 总数 + 状态分布
  const total = sorted.length;
  const completed = sorted.filter((l) => l.status === "completed").length;
  const cancelled = sorted.filter((l) => l.status === "cancelled").length;
  const noShow = sorted.filter((l) => l.status === "no_show").length;
  const scheduled = total - completed - cancelled - noShow;
  const totalMin = sorted
    .filter((l) => l.status === "completed")
    .reduce((s, l) => s + Number(l.duration_min || 0), 0);
  rows.push([]);
  rows.push(["汇总"]);
  const rangeLabel = viewMode === "week" ? "整周" : weekMode ? "本周(单选chip)" : "单日";
  rows.push(["导出范围", rangeLabel]);
  rows.push(["总课节", total]);
  rows.push(["  已完成", completed]);
  rows.push(["  已排(待上)", scheduled]);
  rows.push(["  缺席", noShow]);
  rows.push(["  取消", cancelled]);
  rows.push(["累计时长(完成, 分钟)", totalMin]);

  return rows;
}

/**
 * 触发浏览器下载 .xlsx
 *   lessons: 当前视图下的课节数组
 *   viewMode: 'week' | 'month' | 'teacher' | 'student'
 *   anchor: Date 锚点 (周开始 / 当天 / 月内任一天)
 *   weekMode: boolean — 老师/学员视图下, 单选 chip 时为 true (导本周)
 *
 * 返回 { ok: boolean, filename?, count?, reason? }：
 *   空结果**不抛异常也不 alert**，由调用方弹 toast —— 页面统一用 toast 反馈，
 *   混一个浏览器原生弹窗会破坏视觉一致性（也让用户没法连续操作）。
 */
export function exportScheduleExcel(lessons, viewMode, anchor, weekMode = false) {
  if (!lessons || lessons.length === 0) {
    return { ok: false, reason: "当前视图没有可导出的课节" };
  }

  const rows = buildRows(lessons, viewMode, anchor, weekMode);
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 列宽 (按字符数)
  ws["!cols"] = [
    { wch: 12 }, // 日期
    { wch: 6 }, // 星期
    { wch: 8 }, // 开始
    { wch: 8 }, // 结束
    { wch: 10 }, // 时长
    { wch: 10 }, // 状态
    { wch: 16 }, // 学员
    { wch: 16 }, // 老师
    { wch: 24 }, // 备注
  ];

  // 冻结首行
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  const sheetName =
    viewMode === "week"
      ? "周排课"
      : viewMode === "month"
        ? "月排课"
        : viewMode === "teacher"
          ? "老师视图"
          : "学员视图";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // 文件名: 排课_视图_日期.xlsx (weekMode 时用周一日期)
  const a = anchor instanceof Date ? anchor : new Date();
  const datePart = weekMode ? fmtDate(weekStartOf(a)) : fmtDate(a);
  const filename = `排课_${sheetName}_${datePart}.xlsx`;

  // 触发浏览器下载
  XLSX.writeFile(wb, filename);
  return { ok: true, filename, count: lessons.length };
}

function weekStartOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
