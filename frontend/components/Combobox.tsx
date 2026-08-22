"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

// A generic searchable single-select. Filters options as you type, closes on
// outside-click or Escape, and is keyboard navigable (Up/Down/Enter). Built to
// stay usable when the option list is large (services, endpoints, hosts at
// enterprise scale), so it filters rather than rendering one giant native list.
export default function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search...",
  disabled = false,
  emptyText = "No matches",
  label,
}: {
  options: string[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? options.filter((o) => o.toLowerCase().includes(term)) : options;
  }, [q, options]);

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  function pick(opt: string) {
    onChange(opt);
    setQ("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const base =
    "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        autoComplete="off"
        disabled={disabled}
        className={base}
        placeholder={placeholder}
        value={open ? q : value ?? ""}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-white/10 bg-[#0d0d11] py-1 shadow-xl"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-white/30">{emptyText}</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt}
                role="option"
                aria-selected={opt === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  i === active ? "bg-white/10" : ""
                } ${opt === value ? "text-white" : "text-white/70"}`}
              >
                {opt}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
