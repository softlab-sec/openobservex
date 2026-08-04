"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend, type AnomalyRow, type AnomalyEvidence } from "@/lib/api";
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
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<AnomalyRow>(`/api/v1/alerts/anomalies/${id}`)
      .then(setA).catch((e: Error) => setErr(e.message));
    apiGet<AnomalyEvidence>(`/api/v1/alerts/anomalies/${id}/evidence`)
      .then(setEv).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function act(action: "resolve" | "dismiss" | "escalate") {
    setBusy(action);
    try {
      await apiSend(`/api/v1/alerts/anomalies/${id}/${action}`, "POST");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (err) return <Shell><p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p></Shell>;
  if (!a) return <Shell><p className="text-sm text-white/40">Loading anomaly…</p></Shell>;

  const m = sevMeta(a.severity);
  const active = a.status === "active";
  const deviation = a.observed >= a.baseline_mean ? "above" : "below";
  const maxTrend = ev && ev.trend.length ? Math.max(...ev.trend.map((t) => t.value), 1) : 1;
  const an = ev?.analysis;
  const impact = an?.impact;
  const why = an?.why_detected;

  return (
    <Shell>
      <Link href="/anomalies" className="mb-4 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        All anomalies
      </Link>

      {/* 1. WHAT HAPPENED — executive summary */}
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

        {ev?.summary && (
          <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-white/75">
            {ev.summary}
          </p>
        )}
      </div>

      {/* action bar */}
      {(active || !a.promoted_incident_id) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active && (
            <>
              <button onClick={() => act("resolve")} disabled={busy !== null}
                className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
                {busy === "resolve" ? "Resolving…" : "Resolve"}
              </button>
              <button onClick={() => act("dismiss")} disabled={busy !== null}
                className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/[0.08] disabled:opacity-50">
                {busy === "dismiss" ? "Dismissing…" : "Dismiss as false positive"}
              </button>
              {!a.promoted_incident_id && (
                <button onClick={() => act("escalate")} disabled={busy !== null}
                  className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-sm text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50">
                  {busy === "escalate" ? "Escalating…" : "Escalate to incident"}
                </button>
              )}
            </>
          )}
          {!active && a.resolution !== "auto" && (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-white/50">
              {a.resolution === "dismissed" ? "Dismissed as false positive" : "Manually resolved"}
            </span>
          )}
        </div>
      )}

      {a.promoted_incident_id && (
        <Link href={`/incidents/${a.promoted_incident_id}`}
          className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm hover:bg-white/[0.04]">
          <span className="text-white/50">This anomaly was promoted to an incident.</span>
          <span className="ml-auto text-white/70">Open incident →</span>
        </Link>
      )}

      {/* 2. IMPACT */}
      {impact && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ImpactCard label="Affected services" value={String(impact.affected_services)} />
          <ImpactCard label="Affected operations" value={String(impact.affected_operations)} />
          <ImpactCard label={a.metric === "error_rate" ? "Failed requests" : "Impacted calls"} value={impact.failed_requests.toLocaleString()} />
          <ImpactCard label="User impact" value={impact.user_impact}
            tone={impact.user_impact === "High" ? "critical" : impact.user_impact === "Medium" ? "warning" : "neutral"} />
        </div>
      )}


      {/* 4. WHY THIS WAS DETECTED */}
      {why && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 text-sm font-medium text-white/80">Why this anomaly was detected</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <KV label="Metric" value={why.metric} />
            <KV label="Observed" value={why.observed} accent="text-rose-300" />
            <KV label="Baseline" value={why.baseline} />
            <KV label="Deviation" value={why.deviation} />
            <KV label="Detection threshold" value={why.threshold} />
          </div>
          <p className="mt-4 border-t border-white/10 pt-3 text-sm leading-relaxed text-white/65">{why.reason}</p>
        </div>
      )}

      {/* 5. TREND */}
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

      {/* 6. EVIDENCE & CORRELATION — with contribution % */}
      {an && (an.contributions.length > 0 || ev!.affected_services.length > 0) && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-medium text-white/80">Evidence &amp; correlation</h2>
          <p className="mb-4 text-xs text-white/40">Live telemetry from the anomaly window.</p>

          {ev!.affected_services.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Affected services</div>
              <div className="space-y-1.5">
                {ev!.affected_services.map((sv) => (
                  <div key={sv.service} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">{sv.service}</span>
                    {a.metric === "error_rate" ? (
                      <>
                        <span className="text-xs text-rose-300">{sv.error_rate}% errors</span>
                        <span className="text-xs text-white/40">{sv.errors}/{sv.total}</span>
                      </>
                    ) : (
                      <span className="text-xs text-white/40">{sv.total} calls</span>
                    )}
                    <span className="w-20 text-right text-xs text-white/50">p95 {sv.p95_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {an.contributions.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Operations by contribution</div>
              <div className="space-y-1.5">
                {an.contributions.map((c, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 rounded bg-violet-500/12 px-1.5 py-0.5 text-[10px] text-violet-300">{c.contribution_pct}%</span>
                      <span className="shrink-0 font-mono text-xs text-sky-300/80">{c.endpoint}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-white/70">{c.detail}</span>
                      <span className="shrink-0 text-[11px] text-white/35">{c.service}</span>
                      <span className="w-16 shrink-0 text-right text-[11px] text-white/40">{c.occurrences}x</span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-violet-400/60" style={{ width: `${c.contribution_pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev!.sample_traces.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Sample traces</div>
              <div className="space-y-1.5">
                {ev!.sample_traces.slice(0, 5).map((t, ti) => {
                  const label = ti === 0 ? "Highest impact" : ti === ev!.sample_traces.length - 1 ? "Most recent" : "Representative";
                  return (
                    <a key={`${t.trace_id}-${ti}`} href={`/traces?trace=${t.trace_id}`}
                      className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04]">
                      <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/50">{label}</span>
                      <span className="font-mono text-[11px] text-sky-300/80">{t.trace_id.slice(0, 12)}…</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-white/70">{t.operation}</span>
                      <span className="text-[11px] text-white/40">{t.service}</span>
                      <span className="w-16 text-right text-[11px] text-white/50">{t.duration_ms}ms</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. TIMELINE */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-3 text-sm font-medium text-white/80">Timeline</h2>
        <div className="space-y-3">
          <TimelineRow color="bg-amber-400" label="Detected" detail={`${METRIC_LABEL[a.metric]} crossed the detection threshold`} time={a.first_seen} />
          {a.promoted_incident_id && (
            <TimelineRow color="bg-rose-400" label="Escalated to incident" detail="Sustained deviation promoted to a paging incident" time={a.first_seen} />
          )}
          {a.resolved_at && (
            <TimelineRow color="bg-emerald-400" label={a.resolution === "dismissed" ? "Dismissed" : "Resolved"}
              detail={a.resolution === "auto" ? "Metric returned to baseline" : a.resolution === "dismissed" ? "Marked as false positive" : "Manually resolved"} time={a.resolved_at} />
          )}
          {active && <TimelineRow color="bg-rose-400" label="Ongoing" detail="Still deviating from baseline" time={a.last_seen} />}
        </div>
      </div>

      {/* 8. INVESTIGATION GUIDANCE */}
      {an && an.guidance.length > 0 && (
        <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-5">
          <h2 className="mb-3 text-sm font-medium text-white/80">What to investigate next</h2>
          <ol className="space-y-2">
            {an.guidance.map((g, i) => (
              <li key={i} className="flex gap-3 text-sm text-white/75">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] text-sky-300">{i + 1}</span>
                <span>{g}</span>
              </li>
            ))}
          </ol>
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

function KV({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-white/35">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ?? "text-white/80"}`}>{value}</div>
    </div>
  );
}

function ImpactCard({ label, value, tone }: { label: string; value: string; tone?: "critical" | "warning" | "neutral" }) {
  const toneCls =
    tone === "critical" ? "text-rose-300"
    : tone === "warning" ? "text-amber-300"
    : "text-white/85";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className={`text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
    </div>
  );
}

function TimelineRow({ color, label, detail, time }: { color: string; label: string; detail: string; time: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex flex-col items-center">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="mt-1 w-px flex-1 bg-white/10" />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-white/85">{label}</span>
          <span className="text-[11px] text-white/35">{since(time)} ago</span>
        </div>
        <p className="text-xs text-white/50">{detail}</p>
      </div>
    </div>
  );
}
