import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button.jsx";

export function MoreActions({ actions }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 8 });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    actionsRef.current?.querySelector("button:not([disabled])")?.focus();
    function outside(event) {
      if (!rootRef.current?.contains(event.target) && !actionsRef.current?.contains(event.target))
        setOpen(false);
    }
    function escape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function scrolled(event) {
      if (!actionsRef.current?.contains(event.target)) setOpen(false);
    }
    const resized = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);
  return (
    <div className="relative shrink-0" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => {
          const rect = triggerRef.current.getBoundingClientRect();
          setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">更多</span>
      </Button>
      {open &&
        createPortal(
          <div
            ref={actionsRef}
            role="group"
            aria-label="更多操作"
            style={position}
            className="fixed z-modal min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-pop dark:border-gray-700 dark:bg-gray-900"
          >
            {actions.map(({ label, icon: Icon, disabled, onSelect }) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  onSelect();
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
              >
                {Icon && <Icon className="h-4 w-4" />}
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
