"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend, type IncidentRow, type IncidentEvent, type IncidentEvidence } from "@/lib/api";
import { sevMeta, since, duration } from "@/lib/severity";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  latency: "Latency",
  latency_p95: "Latency p95",
  latency_p99: "Latency p99",
  log_spike: "Log spike",
  service_down: "Service down",
};

const EVENT_META: Record<string, { label: string; dot: string }> = {
  fired: { label: "Fired", dot: "bg-rose-500" },
  acknowledged: { label: "Acknowledged", dot: "bg-amber-400" },
  assigned: { label: "Assigned", dot: "bg-sky-400" },
  note: { label: "Note", dot: "bg-white/40" },
  resolved: { label: "Resolved", dot: "bg-emerald-400" },
  reopened: { label: "Reopened", dot: "bg-rose-400" },
};

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [inc, setInc] = useState<IncidentRow | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [ev, setEv] = useState<IncidentEvidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?limit=200")
      .then((rows) => { setInc(rows.find((r) => r.id === id) ?? null); })
      .catch((e: Error) => setErr(e.message));
    apiGet<IncidentEvent[]>(`/api/v1/alerts/incidents/${id}/timeline`)
      .then(setEvents).catch(() => {});
    apiGet<IncidentEvidence>(`/api/v1/alerts/incidents/${id}/evidence`)
      .then(setEv).catch(() => {});
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (err) return <Shell><p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p></Shell>;
  if (!inc) return <Shell><p className="text-sm text-white/40">Loading incident…</p></Shell>;

  const m = sevMeta(inc.severity);
  const firing = inc.status === "firing";
  const ackd = inc.acknowledged_at != null;

  return (
    <Shell>
      <Link href="/incidents" className="mb-4 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        All incidents
      </Link>

      <div className={`rounded-xl border ${m.border} ${m.bg} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${m.bg} ${m.text} ${m.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${firing ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                {firing ? (ackd ? "Acknowledged" : "Open") : "Resolved"}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white/95">{inc.rule_name}</h1>
            <p className="mt-1 text-sm text-white/60">{inc.summary}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-white/90">
              {firing ? since(inc.started_at) : duration(inc.started_at, inc.resolved_at)}
            </div>
            <div className="text-xs text-white/40">{firing ? "open for" : "total duration"}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
          <Fact label="Condition" value={KIND_LABEL[inc.kind] ?? inc.kind} />
          <Fact label="Observed" value={fmt(inc.observed_value, inc.kind)} accent={m.text} />
          <Fact label="Threshold" value={fmt(inc.threshold, inc.kind)} />
          <Fact label="Service" value={inc.service ?? "all services"} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        {firing && !ackd && (
          <button disabled={busy} onClick={() => act(() => apiSend(`/api/v1/alerts/incidents/${id}/acknowledge`, "POST"))}
            className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/25">Acknowledge</button>
        )}
        {firing && (
          <button disabled={busy} onClick={() => act(() => apiSend(`/api/v1/alerts/incidents/${id}/resolve`, "POST"))}
            className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25">Resolve</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assign to someone…"
            className="w-44 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-white/40" />
          <button disabled={busy || !assignee.trim()}
            onClick={() => act(async () => { await apiSend(`/api/v1/alerts/incidents/${id}/assign`, "POST", { assignee: assignee.trim() }); setAssignee(""); })}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/60 hover:text-white disabled:opacity-40">Assign</button>
        </div>
      </div>

      {(inc.assigned_to || inc.acknowledged_by) && (
        <div className="mt-3 flex flex-wrap gap-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
          {inc.acknowledged_by && <div><span className="text-white/40">Acknowledged by </span><span className="text-white/80">{inc.acknowledged_by}</span></div>}
          {inc.assigned_to && <div><span className="text-white/40">Assigned to </span><span className="text-white/80">{inc.assigned_to}</span></div>}
        </div>
      )}

      {ev && (ev.affected_services.length > 0 || ev.error_patterns.length > 0) && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-medium text-white/80">What&apos;s triggering this</h2>
          <p className="mb-4 text-xs text-white/40">Live telemetry from the incident window.</p>

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

          {ev.triggers && ev.triggers.length > 0 && (
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
              <div className="mb-2 text-xs uppercase tracking-wide text-white/35">Sample failing traces</div>
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

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-medium text-white/80">Activity</h2>
        <div className="relative space-y-4 pl-2">
          {events.map((ev2, idx) => {
            const em = EVENT_META[ev2.kind] ?? { label: ev2.kind, dot: "bg-white/40" };
            return (
              <div key={ev2.id} className="relative flex gap-3">
                <div className="relative flex flex-col items-center">
                  <span className={`z-10 mt-0.5 h-2.5 w-2.5 rounded-full ${em.dot}`} />
                  {idx < events.length - 1 && <span className="absolute top-3 h-full w-px bg-white/10" />}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/80">{em.label}</span>
                    {ev2.actor && <span className="text-xs text-white/40">{ev2.actor}</span>}
                    <span className="ml-auto text-xs text-white/30">{new Date(ev2.created_at).toLocaleString()}</span>
                  </div>
                  {ev2.detail && <p className="mt-0.5 text-sm text-white/55">{ev2.detail}</p>}
                </div>
              </div>
            );
          })}
          {events.length === 0 && <p className="text-sm text-white/30">No activity recorded yet.</p>}
        </div>

        <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline…"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40" />
          <button disabled={busy || !note.trim()}
            onClick={() => act(async () => { await apiSend(`/api/v1/alerts/incidents/${id}/note`, "POST", { detail: note.trim() }); setNote(""); })}
            className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/25 disabled:opacity-40">Add note</button>
        </div>
      </div>
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

function fmt(v: number, kind: string): string {
  if (kind.startsWith("latency")) return `${v.toFixed(0)} ms`;
  if (kind === "error_rate") return `${v.toFixed(2)}%`;
  return v.toFixed(2);
}
