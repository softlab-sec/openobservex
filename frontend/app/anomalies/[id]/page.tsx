"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, type AnomalyRow, type AnomalyEvidence } from "@/lib/api";
import { sevMeta, since, duration } from "@/lib/severity";

const METRIC_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  p95_latency: "p95 latency",
};

function fmtVal(v: number, metric: string): string {
  return metric === "error_rate" ? `${v.toFixed(2)}%` : `${v.toFixed(0)} ms`;
}

export default function AnomalyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [a, setA] = useState<AnomalyRow | null>(null);
  const [ev, setEv] = useState<AnomalyEvidence | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<AnomalyRow>(`/api/v1/alerts/anomalies/${id}`)
      .then(setA).catch((e: Error) => setErr(e.message));
    apiGet<AnomalyEvidence>(`/api/v1/alerts/anomalies/${id}/evidence`)
      .then(setEv).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (err) return <Shell><p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p></Shell>;
  if (!a) return <Shell><p className="text-sm text-white/40">Loading anomaly…</p></Shell>;

  const m = sevMeta(a.severity);
  const active = a.status === "active";
  const deviation = a.observed >= a.baseline_mean ? "above" : "below";
  const maxTrend = ev && ev.trend.length ? Math.max(...ev.trend.map((t) => t.value), 1) : 1;

  return (
    <Shell>
      <Link href="/anomalies" className="mb-4 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        All anomalies
      </Link>

      <div className={`rounded-xl border ${m.border} ${m.bg} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${m.bg} ${m.text} ${m.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${active ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                {active ? "Active" : "Resolved"}
              </span>
              <span className="rounded bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/50">{METRIC_LABEL[a.metric] ?? a.metric}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white/95">{a.service}</h1>
            <p className="mt-1 text-sm text-white/60">
              {fmtVal(a.observed, a.metric)} observed, {deviation} the baseline of {fmtVal(a.baseline_mean, a.metric)}.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-white/90">{a.z_score.toFixed(1)}σ</div>
            <div className="text-xs text-white/40">deviation</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
          <Fact label="Observed" value={fmtVal(a.observed, a.metric)} accent={m.text} />
          <Fact label="Baseline" value={fmtVal(a.baseline_mean, a.metric)} />
          <Fact label="Occurrences" value={`${a.occurrences}x`} />
          <Fact label={active ? "Active for" : "Lasted"} value={active ? since(a.first_seen) : duration(a.first_seen, a.resolved_at)} />
        </div>
      </div>

      {a.promoted_incident_id && (
        <Link href={`/incidents/${a.promoted_incident_id}`}
          className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm hover:bg-white/[0.04]">
          <span className="text-white/50">This anomaly was promoted to an incident.</span>
          <span className="ml-auto text-white/70">Open incident →</span>
        </Link>
      )}

      <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-violet-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 00-4 12.7V17a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 2zM9 21h6" /></svg>
          <h2 className="text-sm font-medium text-white/80">Root-cause analysis</h2>
        </div>
        <p className="mt-2 text-sm text-white/40">
          AI root-cause analysis for this anomaly will appear here.
        </p>
      </div>

      {ev && ev.trend.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 text-sm font-medium text-white/80">{METRIC_LABEL[a.metric] ?? a.metric} over the window</h2>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {ev.trend.map((t, i) => (
              <div key={i} className="flex-1 rounded-t bg-sky-400/40" style={{ height: `${Math.max(3, (t.value / maxTrend) * 100)}%` }} title={`${t.bucket}: ${t.value}`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/30">
            <span>{ev.trend[0]?.bucket?.slice(11, 16)}</span>
            <span>{ev.trend[ev.trend.length - 1]?.bucket?.slice(11, 16)}</span>
          </div>
        </div>
      )}

      {ev && (ev.affected_services.length > 0 || ev.triggers.length > 0) && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-medium text-white/80">What&apos;s happening</h2>
          <p className="mb-4 text-xs text-white/40">Live telemetry from the anomaly window.</p>

          {ev.affected_services.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Affected services</div>
              <div className="space-y-1.5">
                {ev.affected_services.map((sv) => (
                  <div key={sv.service} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">{sv.service}</span>
                    <span className="text-xs text-rose-300">{sv.error_rate}% errors</span>
                    <span className="text-xs text-white/40">{sv.errors}/{sv.total}</span>
                    <span className="w-20 text-right text-xs text-white/50">p95 {sv.p95_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev.triggers.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Triggering operations</div>
              <div className="space-y-1.5">
                {ev.triggers.slice(0, 8).map((tg, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <span className="shrink-0 rounded bg-rose-500/12 px-1.5 py-0.5 text-[10px] text-rose-300">{tg.occurrences}x</span>
                    <span className="shrink-0 font-mono text-xs text-sky-300/80">{tg.endpoint}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-white/70">{tg.error}</span>
                    <span className="shrink-0 text-[11px] text-white/35">{tg.service}</span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-white/40">p95 {tg.p95_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev.sample_traces.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Sample traces</div>
              <div className="space-y-1.5">
                {ev.sample_traces.slice(0, 5).map((t, ti) => (
                  <a key={`${t.trace_id}-${ti}`} href={`/traces?trace=${t.trace_id}`}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04]">
                    <span className="font-mono text-[11px] text-sky-300/80">{t.trace_id.slice(0, 12)}…</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-white/70">{t.operation}</span>
                    <span className="text-[11px] text-white/40">{t.service}</span>
                    <span className="w-16 text-right text-[11px] text-white/50">{t.duration_ms}ms</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-white/35">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ?? "text-white/80"}`}>{value}</div>
    </div>
  );
}
