"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { apiGet, type AnomalyRow } from "@/lib/api";
import { sevMeta, since } from "@/lib/severity";

const METRIC_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  p95_latency: "p95 latency",
};

function fmtVal(v: number, metric: string): string {
  return metric === "error_rate" ? `${v.toFixed(2)}%` : `${v.toFixed(0)} ms`;
}

type Filter = "active" | "all" | "resolved";

export default function AnomaliesPage() {
  const [items, setItems] = useState<AnomalyRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");

  const load = () =>
    apiGet<AnomalyRow[]>("/api/v1/alerts/anomalies?limit=200")
      .then((r) => { setItems(r); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  usePoll(load, [], 10000);

  const active = items.filter((a) => a.status === "active");
  const counts = {
    active: active.length,
    critical: active.filter((a) => a.severity === "critical").length,
    promoted: active.filter((a) => a.promoted_incident_id).length,
  };

  const shown = useMemo(() => {
    let list = items;
    if (filter === "active") list = list.filter((a) => a.status === "active");
    else if (filter === "resolved") list = list.filter((a) => a.status === "resolved");
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return Math.abs(b.z_score) - Math.abs(a.z_score);
    });
  }, [items, filter]);

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Anomalies</h1>
        <p className="text-sm text-white/40">
          Statistical deviations from each service&apos;s recent baseline. Sustained anomalies are promoted to incidents.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Tile label="Active" value={counts.active} tone="neutral" />
        <Tile label="Critical" value={counts.critical} tone="critical" />
        <Tile label="Promoted to incident" value={counts.promoted} tone="info" />
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
            <div key={a.id}
              className="flex items-stretch border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
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
                  {a.promoted_incident_id ? (
                    <Link href={`/incidents/${a.promoted_incident_id}`}
                      className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/5">
                      Open incident →
                    </Link>
                  ) : (
                    <span className="text-[11px] text-white/30">not promoted</span>
                  )}
                  <div className="w-16 text-right">
                    <div className="text-xs text-white/60">{since(a.last_seen)}</div>
                    <div className="text-[11px] text-white/30">ago</div>
                  </div>
                </div>
              </div>
            </div>
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

function Tile({ label, value, tone }: { label: string; value: number; tone: "critical" | "info" | "neutral" }) {
  const toneCls =
    tone === "critical" ? "border-rose-500/30 text-rose-300"
    : tone === "info" ? "border-sky-400/30 text-sky-300"
    : "border-white/15 text-white/70";
  return (
    <div className={`rounded-xl border bg-white/[0.02] px-4 py-3 ${toneCls}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
    </div>
  );
}
