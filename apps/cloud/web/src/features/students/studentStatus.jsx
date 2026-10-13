// 学员五状态：在读 / 停课 / 休学 / 结课 / 退费。仅 active 参与预警与续费提醒。
import { Badge } from "../../components/ui/badge.jsx";
import { uiT } from "../../i18n/store.js";

export const STUDENT_STATUSES = ["active", "inactive", "leave", "graduated", "refunded"];

export const STUDENT_STATUS_META = {
  active: { label: "在读", variant: "success" },
  inactive: { label: "停课", variant: "secondary" },
  leave: { label: "休学", variant: "warning" },
  graduated: { label: "结课", variant: "default" },
  refunded: { label: "退费", variant: "destructive" },
};

// Excel 导出 / 历史数据兜底：未知状态原样返回，不丢信息。
export function studentStatusLabel(status) {
  const meta = STUDENT_STATUS_META[status];
  return meta ? uiT(meta.label) : status || "";
}

export function StudentStatusBadge({ status }) {
  const meta = STUDENT_STATUS_META[status];
  if (!meta) return status ? <Badge variant="secondary">{status}</Badge> : null;
  return <Badge variant={meta.variant}>{uiT(meta.label)}</Badge>;
}
