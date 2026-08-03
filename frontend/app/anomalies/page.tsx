"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { apiGet, type AnomalyRow } from "@/lib/api";
import { RangePicker } from "@/components/ui";
import { sevMeta, since } from "@/lib/severity";

const METRIC_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  p95_latency: "p95 latency",
};

function fmtVal(v: number, metric: string): string {
  return metric === "error_rate" ? `${v.toFixed(2)}%` : `${v.toFixed(0)} ms`;
}

type Filter = "active" | "all" | "resolved" | "critical" | "promoted";

export default function AnomaliesPage() {
  const [items, setItems] = useState<AnomalyRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [minutes, setMinutes] = useState(60);

  const withinWindow = (a: AnomalyRow) => {
    const cutoff = Date.now() - minutes * 60_000;
    if (a.status === "active") return true;
    const ls = new Date(a.last_seen).getTime();
    const fs = new Date(a.first_seen).getTime();
    return ls >= cutoff || fs >= cutoff;
  };

  const load = () =>
    apiGet<AnomalyRow[]>("/api/v1/alerts/anomalies?limit=200")
      .then((r) => { setItems(r); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  usePoll(load, [], 10000);

  const windowed = items.filter(withinWindow);
  const counts = {
    total: windowed.length,
    active: windowed.filter((a) => a.status === "active").length,
    resolved: windowed.filter((a) => a.status === "resolved").length,
    critical: windowed.filter((a) => a.severity === "critical").length,
    promoted: windowed.filter((a) => a.promoted_incident_id).length,
  };

  const shown = useMemo(() => {
    let list = items.filter(withinWindow);
    if (filter === "active") list = list.filter((a) => a.status === "active");
    else if (filter === "resolved") list = list.filter((a) => a.status === "resolved");
    else if (filter === "critical") list = list.filter((a) => a.severity === "critical");
    else if (filter === "promoted") list = list.filter((a) => a.promoted_incident_id);
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return Math.abs(b.z_score) - Math.abs(a.z_score);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, minutes]);

  return (
    <Shell>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Anomalies</h1>
          <p className="text-sm text-white/40">
            Statistical deviations from each service&apos;s recent baseline. Sustained anomalies are promoted to incidents.
          </p>
        </div>
        <RangePicker value={minutes} onChange={setMinutes} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Total" value={counts.total} tone="neutral" active={filter === "all"} onClick={() => setFilter("all")} />
        <Tile label="Active" value={counts.active} tone="active" active={filter === "active"} onClick={() => setFilter("active")} />
        <Tile label="Resolved" value={counts.resolved} tone="resolved" active={filter === "resolved"} onClick={() => setFilter("resolved")} />
        <Tile label="Critical" value={counts.critical} tone="critical" active={filter === "critical"} onClick={() => setFilter("critical")} />
        <Tile label="Promoted" value={counts.promoted} tone="info" active={filter === "promoted"} onClick={() => setFilter("promoted")} />
      </div>

      {err && <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}

      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
          {(["active", "all", "resolved"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 capitalize transition ${filter === f ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-white/40">{shown.length} shown</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        {shown.map((a) => {
          const m = sevMeta(a.severity);
          const resolved = a.status === "resolved";
          const deviation = a.observed >= a.baseline_mean ? "above" : "below";
          return (
            <Link key={a.id} href={`/anomalies/${a.id}`}
              className="group flex items-stretch border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
              <span className={`w-1 shrink-0 ${resolved ? "bg-white/10" : m.bar}`} />
              <div className="flex flex-1 flex-wrap items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.bg} ${m.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
                    </span>
                    <span className="font-medium text-white/90">{a.service}</span>
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/45">{METRIC_LABEL[a.metric] ?? a.metric}</span>
                    {resolved
                      ? <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] text-emerald-300/90">resolved</span>
                      : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">active</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
                    <span className="text-white/75">{fmtVal(a.observed, a.metric)}</span>
                    <span className="text-white/35">{deviation} baseline {fmtVal(a.baseline_mean, a.metric)}</span>
                    <span>·</span>
                    <span>z = {a.z_score.toFixed(1)}</span>
                    <span>·</span>
                    <span>{a.occurrences}x</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {a.promoted_incident_id && (
                    <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] text-violet-300">incident</span>
                  )}
                  <div className="w-16 text-right">
                    <div className="text-xs text-white/60">{since(a.last_seen)}</div>
                    <div className="text-[11px] text-white/30">ago</div>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-white/20 group-hover:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
              </div>
            </Link>
          );
        })}
        {shown.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-white/40">
            {filter === "active" ? "No active anomalies. All services within baseline." : "No anomalies match this filter."}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Tile({ label, value, tone, active, onClick }: {
  label: string; value: number;
  tone: "critical" | "info" | "neutral" | "active" | "resolved";
  active: boolean; onClick: () => void;
}) {
  const toneCls =
    tone === "critical" ? "border-rose-500/30 text-rose-300"
    : tone === "info" ? "border-sky-400/30 text-sky-300"
    : tone === "active" ? "border-amber-400/30 text-amber-300"
    : tone === "resolved" ? "border-emerald-400/30 text-emerald-300"
    : "border-white/15 text-white/70";
  return (
    <button onClick={onClick}
      className={`rounded-xl border bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.05] ${toneCls} ${active ? "ring-2 ring-white/30" : ""}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
    </button>
  );
}
