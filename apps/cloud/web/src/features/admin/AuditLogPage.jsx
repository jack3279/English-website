import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table.jsx";
import { useState } from "react";
import { Loading } from "../../components/ui/loading.jsx";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search, RefreshCw, Filter } from "lucide-react";
import { http } from "../../lib/http.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Button } from "../../components/ui/button.jsx";

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const r = await http("/audit");
      return r.data ?? [];
    },
    refetchInterval: 60_000,
  });

  const rows = (data ?? []).filter((r) => {
    if (actionFilter && !r.action?.startsWith(actionFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.action?.toLowerCase().includes(q) ||
        r.actor?.toLowerCase().includes(q) ||
        r.target_type?.toLowerCase().includes(q) ||
        JSON.stringify(r.payload ?? {})
          .toLowerCase()
          .includes(q)
      );
    }
    return true;
  });

  const actions = [...new Set((data ?? []).map((r) => r.action?.split(".")[0]).filter(Boolean))];

  return (
    <div className="min-h-full">
      <PageHeader
        icon={FileText}
        title="审计日志"
        subtitle={`最近 100 条 · ${rows.length} 显示`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        }
      />

      <main className="page-body space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-card ring-1 ring-slate-900/[0.05] dark:bg-gray-900 dark:ring-white/[0.06]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 动作/操作者/对象/详情"
              className="w-full h-9 pl-9 pr-3 border border-gray-300 dark:border-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="h-9 px-2 border border-gray-300 rounded-md text-sm bg-white dark:bg-gray-900 dark:border-gray-700 "
            >
              <option value="">全部动作</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}.*
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-900/[0.05] dark:bg-gray-900 dark:ring-white/[0.06]">
          {isLoading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <div className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-400">
                暂无匹配的审计记录
              </div>
              {(search || actionFilter) && (
                <button
                  onClick={() => {
                    setSearch("");
                    setActionFilter("");
                  }}
                  className="mt-2 text-xs text-primary-700 hover:underline dark:text-primary-300 "
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="text-left bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
                  <TableHead className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    时间
                  </TableHead>
                  <TableHead className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    动作
                  </TableHead>
                  <TableHead className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    操作者
                  </TableHead>
                  <TableHead className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    对象
                  </TableHead>
                  <TableHead className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    详情
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:bg-gray-950/50 dark:border-gray-800 dark:hover:bg-gray-800/40 "
                  >
                    <TableCell className="px-4 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-400 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour12: false,
                      })}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:text-gray-300 font-mono dark:bg-gray-800 ">
                        {r.action}
                      </code>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-400 font-mono text-xs">
                      {(r.actor || "").slice(0, 8)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-400">
                      <span>{r.target_type}</span>
                      <span className="ml-2 font-mono text-xs">
                        {(r.target_id || "").slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-400 max-w-md truncate font-mono">
                      {r.payload ? JSON.stringify(r.payload).slice(0, 80) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>
    </div>
  );
}
