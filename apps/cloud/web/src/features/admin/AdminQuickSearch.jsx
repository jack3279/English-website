import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight } from "lucide-react";
import { Dialog } from "../../components/ui/dialog.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Button } from "../../components/ui/button.jsx";
import { http } from "../../lib/http.js";
export default function AdminQuickSearch() {
  const [open, setOpen] = useState(false),
    [term, setTerm] = useState(""),
    [delayed, setDelayed] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const students = useQuery({
    queryKey: ["quick-search", "students", delayed],
    queryFn: async () =>
      (await http(`/students?${new URLSearchParams({ search: delayed, pageSize: "20" })}`)).data,
    enabled: open && !!delayed,
    staleTime: 30000,
  });
  const teachers = useQuery({
    queryKey: ["teachers", "list"],
    queryFn: async () => (await http("/teachers")).data,
    enabled: open,
    staleTime: 60000,
  });
  const pupils = Array.isArray(students.data) ? students.data : [],
    staff = (Array.isArray(teachers.data) ? teachers.data : [])
      .filter((t) =>
        `${t.full_name || ""} ${t.email || ""} ${(t.specialties || []).join(" ")}`
          .toLowerCase()
          .includes(delayed.toLowerCase()),
      )
      .slice(0, 10);
  return (
    <>
      <button
        type="button"
        aria-label="快速查找学员与教师"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500 xl:flex dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 "
      >
        <Search className="h-4 w-4" />
        查找学员、教师
        <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400 ">Ctrl K</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="快速查找"
        description="搜索学员档案，或按姓名、邮箱、专长查找教师。"
      >
        <div className="space-y-4">
          <Input
            autoFocus
            aria-label="快速搜索"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="输入学员姓名或教师关键词"
          />
          {!delayed ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400 ">
              输入关键词开始查找
            </p>
          ) : (
            <>
              {(students.isError || teachers.isError) && (
                <p role="alert" className="text-sm text-danger-600 dark:text-danger-300 ">
                  部分结果加载失败{" "}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      students.refetch();
                      teachers.refetch();
                    }}
                  >
                    重试
                  </Button>
                </p>
              )}
              <section>
                <h3 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 ">
                  学员
                </h3>
                {students.isLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 ">正在搜索…</p>
                ) : !pupils.length ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 ">没有匹配学员</p>
                ) : (
                  pupils.map((s) => (
                    <Link
                      onClick={() => setOpen(false)}
                      className="quick-search-result"
                      key={s.id}
                      to={`/students/${s.id}`}
                    >
                      <span className="font-medium">{s.full_name}</span>
                      <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 ">
                        剩余 {s.remaining_hours ?? 0} 小时
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  ))
                )}
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 ">
                  教师
                </h3>
                {staff.map((t) => (
                  <Link
                    onClick={() => setOpen(false)}
                    className="quick-search-result"
                    key={t.id}
                    to={`/admin/teachers?search=${encodeURIComponent(t.full_name || "")}`}
                  >
                    <span className="font-medium">{t.full_name}</span>
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 ">
                      教师档案
                    </span>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                ))}
                {!teachers.isLoading && !staff.length && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 ">没有匹配教师</p>
                )}
              </section>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
