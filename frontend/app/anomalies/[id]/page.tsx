"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend, type AnomalyRow, type AnomalyEvidence } from "@/lib/api";
import { sevMeta, since, duration } from "@/lib/severity";
import { ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const METRIC_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  p95_latency: "Latency",
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

  if (err) return <Shell><p className="rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p></Shell>;
  if (!a) return <Shell><p className="text-sm text-text-muted">Loading anomaly…</p></Shell>;

  const m = sevMeta(a.severity);
  const active = a.status === "active";
  const deviation = a.observed >= a.baseline_mean ? "above" : "below";
  const maxTrend = ev && ev.trend.length ? Math.max(...ev.trend.map((t) => t.value), 1) : 1;
  const an = ev?.analysis;
  const impact = an?.impact;
  const why = an?.why_detected;
  const pattern = an?.pattern;

  return (
    <Shell>
      <Link href="/anomalies" className="mb-4 inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
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
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${active ? "bg-status-critical/15 text-status-critical" : "bg-status-healthy/15 text-status-healthy"}`}>
                {active ? "Active" : "Resolved"}
              </span>
              <span className="rounded bg-surface-elevated px-2 py-0.5 text-[11px] text-text-muted">{METRIC_LABEL[a.metric] ?? a.metric}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-muted">{a.service}</h1>
            <p className="mt-1 text-sm text-text-secondary">
              {fmtVal(a.observed, a.metric)} observed, {deviation} the baseline of {fmtVal(a.baseline_mean, a.metric)}.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-text-secondary">{a.z_score.toFixed(1)}σ</div>
            <div className="text-xs text-text-muted">deviation</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <Fact label="Observed" value={fmtVal(a.observed, a.metric)} accent={m.text} />
          <Fact label="Baseline" value={fmtVal(a.baseline_mean, a.metric)} />
          <Fact label="Occurrences" value={`${a.occurrences}x`} />
          <Fact label={active ? "Active for" : "Lasted"} value={active ? since(a.first_seen) : duration(a.first_seen, a.resolved_at)} />
        </div>

        {ev?.summary && (
          <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-text-secondary">
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
                className="rounded-lg border border-status-healthy/30 bg-status-healthy/10 px-3 py-1.5 text-sm text-status-healthy transition hover:bg-status-healthy/20 disabled:opacity-50">
                {busy === "resolve" ? "Resolving…" : "Resolve"}
              </button>
              <button onClick={() => act("dismiss")} disabled={busy !== null}
                className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-elevated disabled:opacity-50">
                {busy === "dismiss" ? "Dismissing…" : "Dismiss as false positive"}
              </button>
              {!a.promoted_incident_id && (
                <button onClick={() => act("escalate")} disabled={busy !== null}
                  className="rounded-lg border border-status-critical/30 bg-status-critical/10 px-3 py-1.5 text-sm text-status-critical transition hover:bg-status-critical/20 disabled:opacity-50">
                  {busy === "escalate" ? "Escalating…" : "Escalate to incident"}
                </button>
              )}
            </>
          )}
          {!active && a.resolution !== "auto" && (
            <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-xs text-text-muted">
              {a.resolution === "dismissed" ? "Dismissed as false positive" : "Manually resolved"}
            </span>
          )}
        </div>
      )}

      {a.promoted_incident_id && (
        <Link href={`/incidents/${a.promoted_incident_id}`}
          className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-sm hover:bg-surface-elevated">
          <span className="text-text-muted">This anomaly was promoted to an incident.</span>
          <span className="ml-auto text-text-secondary">Open incident →</span>
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


      {/* 3. AI INSIGHTS — analytical pattern classification (not root cause) */}
      {pattern && (
        <div className="mt-4 rounded-xl border border-teal-400/25 bg-teal-500/[0.05] p-5">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-4 w-4 text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5l-2 2m-7 7l-2 2m11 0l-2-2m-7-7l-2-2" /></svg>
            <h2 className="text-sm font-semibold text-text-secondary">AI Insights</h2>
            <span className="ml-auto rounded-full bg-teal-500/15 px-3 py-0.5 text-[11px] font-medium text-teal-200">{pattern.pattern}</span>
          </div>
          <p className="text-sm text-text-secondary">
            <span className="text-text-muted">This looks like a </span>
            <span className="font-medium text-teal-200">{pattern.pattern}</span>
            <span className="text-text-muted"> pattern.</span>
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{pattern.description}</p>
          {pattern.signals.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs uppercase tracking-wide text-text-muted">Signals</div>
              <ul className="space-y-1">
                {pattern.signals.map((sig, i) => (
                  <li key={i} className="flex gap-2 text-sm text-text-secondary"><span className="text-teal-300/70">•</span><span>{sig}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 4. WHY THIS WAS DETECTED */}
      {why && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
          <h2 className="mb-3 text-sm font-medium text-text-secondary">Why this anomaly was detected</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <KV label="Metric" value={why.metric} />
            <KV label="Observed" value={why.observed} accent="text-status-critical" />
            <KV label="Baseline" value={why.baseline} />
            <KV label="Deviation" value={why.deviation} />
            <KV label="Detection threshold" value={why.threshold} />
          </div>
          <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-text-secondary">{why.reason}</p>
        </div>
      )}

      {/* 5. TREND */}
      {ev && ev.trend.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-secondary">Baseline comparison</h2>
            <div className="flex items-center gap-4 text-[11px] text-text-muted">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-status-info" />observed</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-border" />baseline</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-status-healthy/15" />normal range</span>
            </div>
          </div>
          <p className="mb-3 text-xs text-text-muted">Observed {METRIC_LABEL[a.metric]?.toLowerCase() ?? a.metric} against the expected baseline and its normal range. Points outside the band are anomalous.</p>
          {(() => {
            const Z = 3.0;
            const band = a.baseline_std * Z;
            const upper = a.baseline_mean + band;
            const lower = Math.max(0, a.baseline_mean - band);
            const data = ev.trend.map((t) => ({
              time: t.bucket?.slice(11, 16) ?? "",
              observed: t.value,
              lower,
              range: upper - lower,
            }));
            const unit = a.metric === "error_rate" ? "%" : "ms";
            return (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} width={38} unit={unit} />
                    <Tooltip
                      contentStyle={{ background: "#0d0d12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                      formatter={(val: number, name: string) => {
                        if (name === "lower" || name === "range") return [null, null];
                        const dev = a.baseline_std ? ((val - a.baseline_mean) / a.baseline_std).toFixed(1) : "—";
                        return [`${val}${unit} (${dev}σ from baseline)`, "observed"];
                      }}
                    />
                    <Area dataKey="lower" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                    <Area dataKey="range" stackId="band" stroke="none" fill="rgba(52,211,153,0.12)" isAnimationActive={false} />
                    <ReferenceLine y={a.baseline_mean} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
                    <Line dataKey="observed" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>
      )}

      {/* 6. EVIDENCE & CORRELATION — with contribution % */}
      {an && (an.contributions.length > 0 || ev!.affected_services.length > 0) && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
          <h2 className="mb-1 text-sm font-medium text-text-secondary">Evidence &amp; correlation</h2>
          <p className="mb-4 text-xs text-text-muted">Live telemetry from the anomaly window.</p>

          {ev!.affected_services.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Affected services</div>
              <div className="space-y-1.5">
                {ev!.affected_services.map((sv) => (
                  <div key={sv.service} className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-secondary">{sv.service}</span>
                    {a.metric === "error_rate" ? (
                      <>
                        <span className="text-xs text-status-critical">{sv.error_rate}% errors</span>
                        <span className="text-xs text-text-muted">{sv.errors}/{sv.total}</span>
                      </>
                    ) : (
                      <span className="text-xs text-text-muted">{sv.total} calls</span>
                    )}
                    <span className="w-20 text-right text-xs text-text-muted">{sv.p95_ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {an.contributions.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Operations by contribution</div>
              <div className="space-y-1.5">
                {an.contributions.map((c, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 rounded bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent">{c.contribution_pct}%</span>
                      <span className="shrink-0 font-mono text-xs text-status-info/80">{c.endpoint}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{c.detail}</span>
                      <span className="shrink-0 text-[11px] text-text-muted">{c.service}</span>
                      <span className="w-16 shrink-0 text-right text-[11px] text-text-muted">{c.occurrences}x</span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
                      <div className="h-full rounded-full bg-accent/60" style={{ width: `${c.contribution_pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev!.sample_traces.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Sample traces</div>
              <div className="space-y-1.5">
                {ev!.sample_traces.slice(0, 5).map((t, ti) => {
                  const label = ti === 0 ? "Highest impact" : ti === ev!.sample_traces.length - 1 ? "Most recent" : "Representative";
                  return (
                    <a key={`${t.trace_id}-${ti}`} href={`/traces?trace=${t.trace_id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2 hover:bg-surface-elevated">
                      <span className="shrink-0 rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-muted">{label}</span>
                      <span className="font-mono text-[11px] text-status-info/80">{t.trace_id.slice(0, 12)}…</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{t.operation}</span>
                      <span className="text-[11px] text-text-muted">{t.service}</span>
                      <span className="w-16 text-right text-[11px] text-text-muted">{t.duration_ms}ms</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. TIMELINE */}
      <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Timeline</h2>
        <div className="space-y-3">
          <TimelineRow color="bg-status-warning" label="Detected" detail={`${METRIC_LABEL[a.metric]} crossed the detection threshold`} time={a.first_seen} />
          {a.promoted_incident_id && (
            <TimelineRow color="bg-status-critical" label="Escalated to incident" detail="Sustained deviation promoted to a paging incident" time={a.first_seen} />
          )}
          {a.resolved_at && (
            <TimelineRow color="bg-status-healthy" label={a.resolution === "dismissed" ? "Dismissed" : "Resolved"}
              detail={a.resolution === "auto" ? "Metric returned to baseline" : a.resolution === "dismissed" ? "Marked as false positive" : "Manually resolved"} time={a.resolved_at} />
          )}
          {active && <TimelineRow color="bg-status-critical" label="Ongoing" detail="Still deviating from baseline" time={a.last_seen} />}
        </div>
      </div>

      {/* 8. INVESTIGATION GUIDANCE */}
      {an && an.guidance.length > 0 && (
        <div className="mt-4 rounded-xl border border-status-info/20 bg-status-info/[0.04] p-5">
          <h2 className="mb-3 text-sm font-medium text-text-secondary">What to investigate next</h2>
          <ol className="space-y-2">
            {an.guidance.map((g, i) => (
              <li key={i} className="flex gap-3 text-sm text-text-secondary">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-info/15 text-[11px] text-status-info">{i + 1}</span>
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
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ?? "text-text-secondary"}`}>{value}</div>
    </div>
  );
}

function KV({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ?? "text-text-secondary"}`}>{value}</div>
    </div>
  );
}

function ImpactCard({ label, value, tone }: { label: string; value: string; tone?: "critical" | "warning" | "neutral" }) {
  const toneCls =
    tone === "critical" ? "text-status-critical"
    : tone === "warning" ? "text-status-warning"
    : "text-text-secondary";
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
      <div className={`text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{label}</div>
    </div>
  );
}

function TimelineRow({ color, label, detail, time }: { color: string; label: string; detail: string; time: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex flex-col items-center">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="mt-1 w-px flex-1 bg-surface-hover" />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-text-secondary">{label}</span>
          <span className="text-[11px] text-text-muted">{since(time)} ago</span>
        </div>
        <p className="text-xs text-text-muted">{detail}</p>
      </div>
    </div>
  );
}
