import { getDataScope } from "../lib/dataScope.js";
import { uiT, useUiLanguage, uiLocale } from "../i18n/store.js";
import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  ListChecks,
  Sparkles,
  GraduationCap,
  Wallet,
  Settings,
  CalendarX,
  NotebookPen,
  Megaphone,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Archive,
  FileSpreadsheet,
  FileText,
  ChevronRight,
} from "lucide-react";
import { cn } from "../lib/cn.js";
const teacherTools = () => [
  {
    label: uiT("请假与补课"),
    to: "/leave",
    aliases: ["/admin/leave/makeup"],
    icon: CalendarX,
  },
  {
    label: uiT("公告与教材"),
    to: "/content",
    icon: Megaphone,
  },
];
const navigation = () => ({
  admin: [
    {
      label: uiT("工作台"),
      to: "/admin",
      icon: LayoutDashboard,
    },
    {
      label: uiT("课程表"),
      to: "/schedule",
      icon: CalendarDays,
    },
    {
      label: uiT("学员管理"),
      to: "/students",
      icon: Users,
    },
    {
      label: uiT("招生试听"),
      to: "/admin/leads",
      icon: Sparkles,
    },
    {
      label: uiT("教务管理"),
      icon: GraduationCap,
      items: [
        {
          label: uiT("教师档案"),
          to: "/admin/teachers",
          icon: Users,
        },
        teacherTools()[0],
        {
          label: uiT("课后反馈"),
          to: "/admin/reports",
          icon: NotebookPen,
        },
        {
          label: uiT("上课记录"),
          to: "/admin/class-records",
          icon: CalendarDays,
        },
        teacherTools()[1],
        {
          label: uiT("站内沟通"),
          to: "/admin/messages",
          icon: MessageSquare,
        },
      ],
    },
    {
      label: uiT("财务管理"),
      icon: Wallet,
      items: [
        {
          label: "续费订单",
          to: "/renewals",
          icon: Wallet,
        },
        {
          label: uiT("财务报表"),
          to: "/admin/finance",
          icon: TrendingUp,
        },
        {
          label: uiT("教师课酬"),
          to: "/admin/payroll",
          aliases: ["/teacher/payroll"],
          icon: Wallet,
        },
        {
          label: uiT("课时包类型"),
          to: "/admin/packages",
          icon: GraduationCap,
        },
        {
          label: uiT("课时预警"),
          to: "/admin/alerts",
          icon: AlertTriangle,
        },
      ],
    },
    {
      label: uiT("系统管理"),
      icon: Settings,
      items: [
        {
          label: uiT("管理员智能助手"),
          to: "/admin/assistant",
          icon: MessageSquare,
        },
        {
          label: uiT("通知管理"),
          to: "/admin/notifications",
          icon: Megaphone,
        },
        {
          label: uiT("账号管理"),
          to: "/admin/accounts",
          icon: Users,
        },
        {
          label: uiT("机构设置"),
          to: "/admin/institution-settings",
          icon: Settings,
        },
        {
          label: uiT("审计日志"),
          to: "/admin/audit",
          icon: FileText,
        },
        {
          label: uiT("数据工具"),
          icon: Archive,
          items: [
            {
              label: uiT("数据备份"),
              to: "/admin/backups",
              icon: Archive,
            },
            {
              label: uiT("数据导入"),
              to: "/admin/import",
              icon: FileSpreadsheet,
            },
          ],
        },
      ],
    },
  ],
  teacher: [
    {
      label: uiT("今日课程"),
      to: "/teacher/today",
      icon: LayoutDashboard,
    },
    {
      label: uiT("课程表"),
      to: "/schedule",
      icon: CalendarDays,
    },
    {
      label: uiT("我的学生"),
      to: "/students",
      icon: Users,
    },

    {
      label: uiT("上课记录"),
      to: "/admin/class-records",
      icon: CalendarDays,
    },
    {
      label: uiT("教学协作"),
      icon: GraduationCap,
      items: teacherTools(),
    },
  ],
  parent: [
    {
      label: uiT("孩子课程"),
      to: "/parent",
      icon: LayoutDashboard,
    },
    {
      label: uiT("课程表"),
      to: "/schedule",
      icon: CalendarDays,
    },
    {
      label: uiT("上课记录"),
      to: "/parent/feeds",
      icon: NotebookPen,
    },
    {
      label: uiT("请假与补课"),
      to: "/leave",
      icon: CalendarX,
    },
    {
      label: uiT("学校留言"),
      to: "/parent/messages",
      icon: MessageSquare,
    },
    {
      label: uiT("公告与教材"),
      to: "/content",
      icon: Megaphone,
    },
  ],
});
export function getNavigation(role) {
  const items = navigation()[role] ?? [];
  if (getDataScope() !== "test") return items;
  const blocked = new Set(["/admin/backups", "/admin/import", "/admin/assistant", "/renewals"]);
  function filter(list) {
    return list
      .filter((x) => !blocked.has(x.to))
      .map((x) => (x.items ? { ...x, items: filter(x.items) } : x))
      .filter((x) => !x.items || x.items.length);
  }
  return filter(items);
}
export function containsPath(item, pathname) {
  if (item.items) return item.items.some((child) => containsPath(child, pathname));
  const paths = [item.to, ...(item.aliases || [])];
  return paths.some(
    (path) =>
      pathname === path ||
      (path !== "/admin" && path !== "/parent" && pathname.startsWith(`${path}/`)),
  );
}
function NavigationItem({ item, depth = 0, onNavigate }) {
  useUiLanguage();
  const { pathname } = useLocation();
  const active = containsPath(item, pathname);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  useEffect(() => {
    setExpanded(active);
  }, [pathname, active]);
  const Icon = item.icon;
  const rowClass = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition-colors",
    depth === 0 ? "py-2.5" : "py-2",
  );
  if (item.items)
    return (
      <div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            rowClass,
            active
              ? "font-medium text-white bg-white/10"
              : "text-white/75 hover:bg-white/10 hover:text-white",
          )}
        >
          {depth === 0 && <Icon className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-white/50 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <div
          id={id}
          hidden={!expanded}
          className="ml-5 mt-1 space-y-0.5 border-l border-white/15 pl-2"
        >
          {expanded &&
            item.items.map((child) => (
              <NavigationItem
                key={child.label}
                item={child}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            ))}
        </div>
      </div>
    );
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        rowClass,
        active
          ? "bg-white font-medium text-[#0e564f] shadow-sm dark:bg-primary-900/50 dark:text-primary-200"
          : "text-white/75 hover:bg-white/10 hover:text-white",
      )}
    >
      {depth === 0 && <Icon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
export function NavList({ role, onClick }) {
  useUiLanguage();
  const items = getNavigation(role);
  return (
    <nav aria-label={uiT("主导航")} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="space-y-1">
        {items.map((item, index) => (
          <div
            key={item.label}
            className={
              item.items && !items[index - 1]?.items
                ? "mt-4 border-t border-white/10 pt-3"
                : undefined
            }
          >
            <NavigationItem item={item} onNavigate={onClick} />
          </div>
        ))}
      </div>
    </nav>
  );
}
