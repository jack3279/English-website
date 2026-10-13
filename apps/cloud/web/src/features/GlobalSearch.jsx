import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, FileText, Loader2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { http } from "../lib/http.js";
import { Input } from "../components/ui/input.jsx";
import { Card } from "../components/ui/card.jsx";
import { studentStatusLabel } from "./students/studentStatus.jsx";

/**
 * 顶栏全局搜索 —— 模糊搜学员姓名跳转。
 *
 * 设计:
 *  - 默认只搜学员（占 v2 阶段 90% 跳转诉求：进入学员详情页）
 *  - Cmd/Ctrl + K 聚焦；Esc 关闭
 *  - 200ms debounce，避免每个键击打后端
 *  - 顶部输入框，下拉最多 6 条结果；空态/加载态分别有反馈
 *
 * 后续要扩展（搜课节 / 老师 / 通知）也只在这一个组件内改。
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  // 200ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Cmd/Ctrl + K 聚焦
  useEffect(() => {
    function onKey(e) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 点外面关
  useEffect(() => {
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async () => {
      if (!debounced) return { items: [] };
      const r = await http(`/students?search=${encodeURIComponent(debounced)}&pageSize=6`);
      return { items: r.data ?? [] };
    },
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];

  function pick(id) {
    setOpen(false);
    setQ("");
    navigate(`/students/${id}`);
  }

  function onKeyDown(e) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[highlight];
      if (it) pick(it.id);
    }
  }

  return (
    <div ref={boxRef} className="relative w-72 max-w-[40vw]">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 pointer-events-none" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜学员…"
          className="pl-8 pr-16 h-8 text-sm"
          aria-label="全局搜索"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="p-1 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-400 "
              aria-label="清空"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 h-5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[10px] font-mono text-gray-500 dark:text-gray-400">
            ⌘K
          </kbd>
        </div>
      </div>

      {open && debounced && (
        <Card className="absolute z-50 mt-1 left-0 right-0 max-h-[60vh] overflow-y-auto shadow-lg border border-gray-200 dark:border-gray-700 p-1">
          {isFetching && items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400 flex items-center">
              <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> 搜索中…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
              没有匹配「<b>{debounced}</b>」的学员
            </div>
          ) : (
            <ul role="listbox">
              {items.map((s, i) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={i === highlight}
                  tabIndex={0}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded cursor-pointer ${
                    i === highlight
                      ? "bg-primary-50 dark:bg-primary-900/30"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(s.id);
                    }
                  }}
                  onClick={() => pick(s.id)}
                >
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-semibold flex items-center justify-center shrink-0">
                    {(s.full_name || "?").charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                      <Highlight text={s.full_name} query={debounced} />
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5">
                      <User className="w-2.5 h-2.5" />
                      剩余 {Number(s.remaining_hours ?? 0).toFixed(1)}h
                      {s.status && s.status !== "active" && (
                        <span className="ml-1 text-warning-600 dark:text-warning-400">
                          · {studentStatusLabel(s.status)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              <li className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1 px-2.5 py-1.5">
                <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <FileText className="w-2.5 h-2.5" />
                  仅搜学员 · {items.length} 条 · ↑↓ 选择 · Enter 跳转
                </div>
              </li>
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  const idx = (text || "").toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-warning-100 dark:bg-warning-900/40 text-warning-800 dark:text-warning-200 px-0.5 rounded">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
