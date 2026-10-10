"use client";
import { useEffect, useRef, useState } from "react";
import { apiGet, type ServiceStat } from "@/lib/api";

/**
 * Searchable service selector fed by discovered services
 * (GET /api/v1/stats/services). Replaces free-text service entry so
 * alerts are tied to real services the platform has actually seen.
 *
 * value === null means "all services". Selecting a row sets that
 * ServiceName; the "All services" option clears back to null.
 */
export default function ServiceSelect({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (service: string | null) => void;
  className?: string;
}) {
  const [services, setServices] = useState<ServiceStat[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<{ services: ServiceStat[] }>("/api/v1/stats/services?minutes=1440")
      .then((d) => setServices(d.services ?? []))
      .catch(() => setServices([]));
  }, []);

  // close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = query.trim()
    ? services.filter((s) => s.ServiceName.toLowerCase().includes(query.toLowerCase()))
    : services;

  const trigger =
    className ??
    "w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-border flex items-center justify-between";

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" className={trigger} onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-text-primary" : "text-text-muted"}>
          {value ?? "All services"}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-muted">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-[#0d1117] shadow-xl">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search services..."
              className="w-full rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-sm outline-none focus:border-border"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
              className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-elevated ${value === null ? "text-accent" : "text-text-secondary"}`}
            >
              All services
            </button>
            {filtered.map((s) => {
              const bad = s.error_rate >= 5;
              return (
                <button
                  type="button"
                  key={s.ServiceName}
                  onClick={() => { onChange(s.ServiceName); setOpen(false); setQuery(""); }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-elevated ${value === s.ServiceName ? "text-accent" : "text-text-secondary"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${bad ? "bg-status-critical" : "bg-status-healthy"}`} />
                    {s.ServiceName}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-text-muted">
                {services.length === 0 ? "No services discovered yet" : "No match"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
