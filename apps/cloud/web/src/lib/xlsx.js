import { findPayrollSettlement, payrollSettlementChanged } from "./payrollSettlement.js";
// 浏览器端 xlsx 工具。xlsx 包体积大, 一律动态 import, 不进首屏 bundle。
// SheetJS 0.18.5 社区版: xlsx.writeFile 走 <a download>, jsdom 测试里勿触发真实下载。

let _xlsx = null;

async function loadXlsx() {
  if (!_xlsx) _xlsx = await import("xlsx");
  return _xlsx;
}

// rows: 对象数组; headerMap: {列名: 取值字段} 或 null(用对象 key)
export async function exportRowsToXlsx(filename, sheetName, rows, headerMap) {
  const XLSX = await loadXlsx();
  const data = (rows ?? []).map((r) => {
    if (!headerMap) return r;
    const out = {};
    for (const [col, field] of Object.entries(headerMap)) {
      out[col] = typeof field === "function" ? field(r) : r?.[field];
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// 解析上传的 xlsx/csv 文件为行对象数组 (第一行作表头)
export async function parseSheetToRows(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

export async function downloadTemplate(filename, headers) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([headers, headers.map(() => "")]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "模板");
  XLSX.writeFile(wb, filename);
}

// 汇总、课程明细和按币种合计放在同一工作簿，金额保持数值类型。
export async function exportPayrollWorkbook(filename, report, records = []) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const paidFor = (r) => {
    const record = findPayrollSettlement(r, records);
    return record?.state === "paid" ? record : null;
  };
  const summary = (report.rows || []).map((r) => {
    const paid = paidFor(r);
    return {
      教师: r.teacher_name,
      周期: r.period === "weekly" ? "每周" : "每月",
      开始日期: r.period_from,
      结束日期: r.period_to,
      统计开始: report.range.from,
      统计结束: report.range.to,
      约定结算: r.cycle === "weekly" ? "每周" : "每月",
      完成课次: r.lessons_done,
      小时: Number((r.minutes_done / 60).toFixed(2)),
      币种: r.pay_currency,
      应计课酬: r.pay_amount,
      已登记金额: paid ? paid.amount_cents / 100 : 0,
      未登记金额: paid ? (!payrollSettlementChanged(r, paid) ? 0 : null) : r.pay_amount,
      周期完整性:
        report.range.from > r.period_from || report.range.to < r.period_to
          ? "仅所选日期，非完整周期"
          : "完整周期",
      发放状态: paid
        ? !payrollSettlementChanged(r, paid)
          ? "已登记发放"
          : "金额或课程变化待核对"
        : "待登记",
      备注: paid?.note || "",
    };
  });
  const details = (report.details || []).map((d) => ({
    上课日期: d.day,
    上课时间: new Date(d.scheduled_at).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    }),
    教师: d.teacher_name,
    学生: d.student_name,
    点名结果: d.attendance_status === "no_show" ? (d.pay_amount>0?"缺勤（计酬）":"缺勤（不计酬）") : "上课",
    课程: d.course_name,
    分钟: d.duration_min,
    教师时薪: d.hourly_pay,
    币种: d.pay_currency,
    教师课酬: d.pay_amount,
    "学生约定时薪(CNY)": d.student_price,
    "学生约定金额(CNY)": d.student_amount,
    历史课程: d.legacy ? "是" : "否",
    课节编号: d.lesson_id,
  }));
  const totals = Object.entries(report.totals?.by_currency || {}).map(([currency, amount]) => ({
    币种: currency,
    应计课酬: amount,
    口径: "仅已完课；不同币种不相加；学生约定价不代表实收",
  }));
  for (const [name, rows] of [
    ["教师汇总", summary],
    ["课程明细", details],
    ["币种合计", totals],
  ]) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map((key) => ({
      wch: key.includes("时间") ? 24 : key.includes("编号") ? 38 : 18,
    }));
    ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename);
}
