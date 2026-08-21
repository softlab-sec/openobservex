"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { JOB_TITLES } from "@/lib/identity-data";

// Searchable job-title picker. Selecting "Other" reveals a free-text field, and
// the typed value becomes the emitted title. Emits the final string to onChange.
export default function JobTitleSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [isOther, setIsOther] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? JOB_TITLES.filter((t) => t.toLowerCase().includes(term)) : JOB_TITLES;
  }, [q]);

  function pick(title: string) {
    if (title === "Other") {
      setIsOther(true);
      onChange("");
    } else {
      setIsOther(false);
      onChange(title);
    }
    setOpen(false);
    setQ("");
  }

  if (isOther) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your job title"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40"
        />
        <button
          type="button"
          onClick={() => {
            setIsOther(false);
            onChange("");
          }}
          className="shrink-0 rounded-lg border border-white/10 px-3 text-xs text-white/50 transition hover:text-white"
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left text-sm outline-none transition hover:border-white/25 focus:border-white/40"
      >
        <span className={value ? "text-white/80" : "text-white/30"}>
          {value || "Select your role"}
        </span>
        <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-50">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-white/15 bg-neutral-900/95 p-1 shadow-xl backdrop-blur">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search roles"
            className="mb-1 w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm outline-none focus:border-white/30"
          />
          {filtered.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-white/10 ${
                t === "Other" ? "text-sky-300" : "text-white/80"
              } ${value === t ? "bg-white/5" : ""}`}
            >
              {t}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-white/30">No match</p>
          )}
        </div>
      )}
    </div>
  );
}
