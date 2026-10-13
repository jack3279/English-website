import { useEffect } from "react";
import { getToken, getRefreshToken, setSession } from "../lib/auth-store.js";
import { useQuery } from "@tanstack/react-query";
import { http } from "../lib/http.js";
import { getDataScope, setDataScope } from "../lib/dataScope.js";
export function DataScopeBanner({ user }) {
  const identity = useQuery({
    queryKey: ["data-scope-identity", user?.id],
    queryFn: async () => (await http("/me")).data,
    enabled: !!user?.id,
    staleTime: 60000,
  });
  const me = identity.data;
  useEffect(() => {
    if (me && user && (me.is_test_account !== user.is_test_account || me.role !== user.role)) {
      setSession({
        access_token: getToken(),
        refresh_token: getRefreshToken(),
        user: { ...user, ...me },
      });
    }
  }, [me, user]);
  if (!me) return null;
  const test = me.is_test_account || getDataScope() === "test";
  if (me.role !== "admin" && !test) return null;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${test ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}
    >
      <span>
        {test
          ? me.role === "teacher"
            ? "Test mode · Simulation data only"
            : "测试模式 · 仅模拟数据，操作不会影响正式数据"
          : "正式数据 · 统计已排除模拟记录"}
      </span>
      {me.role === "admin" && !me.is_test_account && (
        <select
          aria-label="数据范围"
          className="rounded border bg-white px-2 py-1 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
          value={getDataScope()}
          onChange={(e) => setDataScope(e.target.value)}
        >
          <option value="production">正式数据</option>
          <option value="test">测试数据</option>
        </select>
      )}
    </div>
  );
}
