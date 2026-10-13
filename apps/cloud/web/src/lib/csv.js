// CSV 导出。Excel 打开中文 CSV 必须带 BOM, 否则整片乱码。
// 所有值统一加引号, 逗号/换行/双引号都不会把列冲掉。
function escapeCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(head, rows) {
  return [head, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

export function downloadCsv(filename, head, rows) {
  const blob = new Blob([`\ufeff${toCsv(head, rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 文件名里不能带 / : * ? " < > | 和冒号(部分系统), 日期里的 "-" 保留
export function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_");
}
