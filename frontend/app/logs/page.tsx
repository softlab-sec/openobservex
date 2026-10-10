"use client";

import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import Waterfall from "@/components/Waterfall";
import { Card, RangePicker, SeverityBadge } from "@/components/ui";
import { apiGet, type LogRow, type TraceDetail } from "@/lib/api";

const LEVELS = ["ERROR", "WARN", "INFO"];

export default function LogsPage() {
  const [minutes, setMinutes] = useState(60);
  const [levels, setLevels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ minutes: String(minutes), limit: "100" });
    if (levels.length) params.set("severity", levels.join(","));
    if (query) params.set("search", query);
    return Promise.all([
      apiGet<{ items: LogRow[] }>(`/api/v1/logs?${params.toString()}`),
      apiGet<{ severities: { severity: string; count: number }[] }>(
        `/api/v1/logs/severities?minutes=${minutes}`
      ),
    ])
      .then(([l, s]) => {
        setRows(l.items);
        const c: Record<string, number> = {};
        s.severities.forEach((x) => (c[x.severity] = x.count));
        setCounts(c);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes, levels, query]);

  usePoll(load, [minutes, levels, query]);

  function toggle(level: string) {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  }

  function openTrace(id: string) {
    if (!id) return;
    apiGet<TraceDetail>(`/api/v1/traces/${id}`)
      .then(setTrace)
      .catch(() => setErr("Trace not found for this log"));
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-text-muted">Filter by severity, search message text</p>
        </div>
        <RangePicker value={minutes} onChange={setMinutes} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => toggle(l)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              levels.includes(l)
                ? "border-border bg-surface-hover text-text-primary"
                : "border-border text-text-muted hover:text-text-primary"
            }`}
          >
            {l}
            {counts[l] !== undefined && (
              <span className="ml-1.5 text-text-muted">{counts[l]}</span>
            )}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setQuery(search);
          }}
          placeholder="Search message text, press Enter"
          className="ml-auto w-72 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-border"
        />
        {query && (
          <button
            onClick={() => {
              setSearch("");
              setQuery("");
            }}
            className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        )}
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {err}
        </p>
      )}

      {trace && (
        <Card className="mb-4 border-border bg-surface-elevated">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Correlated trace</div>
              <div className="font-mono text-xs text-text-muted">
                {trace.trace_id} · {trace.span_count} spans ·{" "}
                {trace.total_ms.toFixed(2)} ms
              </div>
            </div>
            <button
              onClick={() => setTrace(null)}
              className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
            >
              Close
            </button>
          </div>
          <Waterfall detail={trace} />
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-elevated">
        <div className="divide-y divide-border font-mono text-[13px] leading-relaxed">
          {rows.map((r, i) => {
            const lvl = r.SeverityText.toUpperCase();
            const accent =
              lvl === "ERROR"
                ? "border-l-red-500/70 bg-status-critical/[0.04]"
                : lvl === "WARN" || lvl === "WARNING"
                  ? "border-l-amber-500/70 bg-status-warning/[0.03]"
                  : "border-l-sky-500/40";
            const isOpen = expanded === i;
            const correlated = trace && trace.trace_id === r.TraceId;
            return (
              <div key={i} className={`border-l-2 ${accent} ${correlated ? "ring-1 ring-inset ring-status-info/40" : ""}`}>
                <button
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left transition hover:bg-surface-elevated"
                >
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {new Date(r.Timestamp).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className="shrink-0">
                    <SeverityBadge level={r.SeverityText} />
                  </span>
                  <span className="shrink-0 text-text-muted">{r.ServiceName}</span>
                  <span className="flex-1 truncate text-text-primary">{r.Body}</span>
                  {r.TraceId && (
                    <span className="shrink-0 text-[10px] text-accent" title="has correlated trace">trace</span>
                  )}
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t border-border bg-surface-elevated px-3 py-3 text-xs">
                    <div className="whitespace-pre-wrap break-words text-text-primary">{r.Body}</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-text-muted">
                      <span className="text-text-muted">Timestamp</span>
                      <span className="tabular-nums">{new Date(r.Timestamp).toISOString()}</span>
                      <span className="text-text-muted">Service</span>
                      <span>{r.ServiceName}</span>
                      <span className="text-text-muted">Severity</span>
                      <span>{lvl}</span>
                      {r.SpanId && (<><span className="text-text-muted">Span</span><span>{r.SpanId}</span></>)}
                      {r.TraceId && (
                        <>
                          <span className="text-text-muted">Trace</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); openTrace(r.TraceId); }}
                            className="text-left text-accent hover:underline"
                          >
                            {r.TraceId} — view waterfall
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="py-10 text-center text-sm text-text-muted">No logs match these filters.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
