"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend, type IncidentRow, type IncidentEvent, type IncidentEvidence } from "@/lib/api";
import { sevMeta, since, duration } from "@/lib/severity";
import { useRole, canOperate } from "@/lib/role";
import IncidentTopology from "@/components/IncidentTopology";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate", latency: "Latency", latency_p95: "Latency p95",
  latency_p99: "Latency p99", log_spike: "Log spike", service_down: "Service down", anomaly: "Anomaly",
};
const EVENT_META: Record<string, { label: string; dot: string }> = {
  fired: { label: "Incident opened", dot: "bg-status-critical" },
  acknowledged: { label: "Acknowledged", dot: "bg-status-warning" },
  assigned: { label: "Assigned", dot: "bg-status-info" },
  note: { label: "Note added", dot: "bg-surface-hover" },
  resolved: { label: "Resolved", dot: "bg-status-healthy" },
  reopened: { label: "Reopened", dot: "bg-status-critical" },
};

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const role = useRole();
  const { id } = use(params);
  const [inc, setInc] = useState<IncidentRow | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [ev, setEv] = useState<IncidentEvidence | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"metrics" | "logs" | "traces">("traces");

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

  if (err) return <Shell><p className="rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p></Shell>;
  if (!inc) return <Shell><p className="text-sm text-text-muted">Loading incident…</p></Shell>;

  const m = sevMeta(inc.severity);
  const firing = inc.status === "firing";
  const ackd = inc.acknowledged_at != null;
  const an = ev?.analysis;
  const svc = inc.service;
  const anchorService = svc ?? ev?.affected_services?.[0]?.service ?? null;
  const win = 60;
  const q = svc ? `?service=${encodeURIComponent(svc)}&minutes=${win}` : `?minutes=${win}`;

  return (
    <Shell>
      <Link href="/incidents" className="mb-4 inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        All incidents
      </Link>

      {/* 1. EXECUTIVE SUMMARY — command-center header */}
      <div className={`rounded-xl border-l-4 ${m.border} border-y border-r border-border bg-gradient-to-r ${firing ? "from-rose-500/[0.07]" : "from-white/[0.02]"} to-transparent p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${m.bg} ${m.text} ${m.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${firing ? "bg-status-critical/15 text-status-critical" : "bg-status-healthy/15 text-status-healthy"}`}>
                {firing ? "Open" : "Resolved"}
              </span>
              {ackd && <span className="rounded-full bg-status-warning/15 px-2.5 py-0.5 text-[11px] text-status-warning">Acknowledged</span>}
              <span className="rounded bg-surface-elevated px-2 py-0.5 text-[11px] text-text-muted">{KIND_LABEL[inc.kind] ?? inc.kind}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-muted">{inc.rule_name}</h1>
            <p className="mt-1 text-sm text-text-secondary">{inc.summary}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-text-secondary">{firing ? since(inc.started_at) : duration(inc.started_at, inc.resolved_at)}</div>
            <div className="text-xs text-text-muted">{firing ? "open for" : "total duration"}</div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <Fact label="Service" value={svc ?? "all services"} />
          <Fact label="Owner" value={inc.assigned_to ?? "unassigned"} accent={inc.assigned_to ? "text-text-secondary" : "text-text-muted"} />
          <Fact label="Started" value={`${since(inc.started_at)} ago`} />
          <Fact label="Acknowledged by" value={inc.acknowledged_by ?? "—"} accent={inc.acknowledged_by ? "text-text-secondary" : "text-text-muted"} />
        </div>
      </div>

      {/* ACTION TOOLBAR — operational */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-elevated p-2.5">
        {firing && !ackd && canOperate(role) && (
          <button disabled={busy} onClick={() => act(() => apiSend(`/api/v1/alerts/incidents/${id}/acknowledge`, "POST"))}
            className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-1.5 text-sm text-status-warning transition hover:bg-status-warning/20 disabled:opacity-50">Acknowledge</button>
        )}
        {firing && canOperate(role) && (
          <button disabled={busy} onClick={() => act(() => apiSend(`/api/v1/alerts/incidents/${id}/resolve`, "POST"))}
            className="rounded-lg border border-status-healthy/30 bg-status-healthy/10 px-3 py-1.5 text-sm text-status-healthy transition hover:bg-status-healthy/20 disabled:opacity-50">Resolve incident</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assign to someone…"
            className="w-40 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-secondary placeholder:text-text-muted focus:outline-none" />
{canOperate(role) &&           <button disabled={busy || !assignee.trim()}
            onClick={() => act(async () => { await apiSend(`/api/v1/alerts/incidents/${id}/assign`, "POST", { assignee: assignee.trim() }); setAssignee(""); })}
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-elevated disabled:opacity-40">Assign</button>}
        </div>
      </div>

      {/* 2. BUSINESS IMPACT */}
      {an && (
        <div className="mt-4">
          <SectionLabel>Business impact</SectionLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ImpactCard label="Affected services" value={String(an.impact.affected_services)} />
            <ImpactCard label="Affected operations" value={String(an.impact.affected_operations)} />
            <ImpactCard label="Impacted requests" value={an.impact.failed_requests.toLocaleString()} />
            <ImpactCard label="User impact" value={an.impact.user_impact}
              tone={an.impact.user_impact === "High" ? "critical" : an.impact.user_impact === "Medium" ? "warning" : "neutral"} />
          </div>
          <p className="mt-2 text-xs text-text-muted">Revenue and user-count impact not tracked in this environment.</p>
        </div>
      )}

      {/* 3. AI ROOT CAUSE ANALYSIS — belongs only to incidents */}
      {an && (
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[0.05] p-5">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-4 w-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 00-4 12.7V17a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 2zM9 21h6" /></svg>
            <h2 className="text-sm font-semibold text-text-secondary">AI Root Cause Analysis</h2>
            <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] ${
              an.rca.confidence === "High" ? "bg-status-healthy/15 text-status-healthy"
              : an.rca.confidence === "Medium" ? "bg-status-warning/15 text-status-warning" : "bg-surface-hover text-text-secondary"}`}>
              {an.rca.confidence} confidence
            </span>
          </div>
          <p className="text-sm text-text-secondary"><span className="text-text-muted">Likely cause: </span>{an.rca.likely_cause}</p>
          {an.rca.evidence.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs uppercase tracking-wide text-text-muted">Supporting evidence</div>
              <ul className="space-y-1">
                {an.rca.evidence.map((e, i) => (
                  <li key={i} className="flex gap-2 text-sm text-text-secondary"><span className="text-accent/70">•</span><span>{e}</span></li>
                ))}
              </ul>
            </div>
          )}
          {an.rca.contributing_factors.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs uppercase tracking-wide text-text-muted">Contributing factors</div>
              <div className="flex flex-wrap gap-1.5">
                {an.rca.contributing_factors.map((f, i) => (
                  <span key={i} className="rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs text-text-secondary">{f}</span>
                ))}
              </div>
            </div>
          )}
          {an.contributions.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Blast radius — operations by contribution</div>
              <div className="space-y-1.5">
                {an.contributions.map((c, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 rounded bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent">{c.contribution_pct}%</span>
                      <span className="shrink-0 font-mono text-xs text-status-info/80">{c.endpoint}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{c.detail}</span>
                      <span className="shrink-0 text-[11px] text-text-muted">{c.service}</span>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
                      <div className="h-full rounded-full bg-accent/60" style={{ width: `${c.contribution_pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. INCIDENT TIMELINE — prominent */}
      <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
        <SectionLabel>Incident timeline</SectionLabel>
        {events.length === 0 ? (
          <p className="text-sm text-text-muted">No activity recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map((e) => {
              const em = EVENT_META[e.kind] ?? { label: e.kind, dot: "bg-surface-hover" };
              return (
                <div key={e.id} className="flex gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span className={`h-2 w-2 rounded-full ${em.dot}`} />
                    <span className="mt-1 w-px flex-1 bg-surface-hover" />
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-text-secondary">{em.label}</span>
                      <span className="text-[11px] text-text-muted">{since(e.created_at)} ago</span>
                    </div>
                    {e.detail && <p className="text-xs text-text-muted">{e.detail}</p>}
                    {e.actor && <p className="text-[11px] text-text-muted">by {e.actor}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex gap-2 border-t border-border pt-4">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline…"
            className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-text-secondary placeholder:text-text-muted focus:outline-none" />
          {canOperate(role) && <button disabled={busy || !note.trim()}
            onClick={() => act(async () => { await apiSend(`/api/v1/alerts/incidents/${id}/note`, "POST", { detail: note.trim() }); setNote(""); })}
            className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-elevated disabled:opacity-40">Add note</button>}
        </div>
      </div>

      {/* 6. SERVICE IMPACT ANALYSIS */}
      {ev && ev.affected_services.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
          <SectionLabel>Service impact analysis</SectionLabel>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 text-right font-medium">Error rate</th>
                  <th className="px-3 py-2 text-right font-medium">Requests</th>
                  <th className="px-3 py-2 text-right font-medium">p95 latency</th>
                </tr>
              </thead>
              <tbody>
                {ev.affected_services.map((sv) => (
                  <tr key={sv.service} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-text-secondary">{sv.service}</td>
                    <td className="px-3 py-2 text-right text-status-critical">{sv.error_rate}%</td>
                    <td className="px-3 py-2 text-right text-text-muted">{sv.total}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{sv.p95_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. INVESTIGATION WORKSPACE — tabbed deep-links */}
      <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
        <SectionLabel>Investigation workspace</SectionLabel>
        <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          {(["traces", "logs", "metrics"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 capitalize transition ${tab === t ? "bg-surface-hover text-text-primary" : "text-text-muted hover:text-text-primary"}`}>{t}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "traces" && <WorkspaceLink href={`/traces${q}`} label="Open filtered traces" sub={svc ? `${svc}, last ${win}m` : `last ${win}m`} />}
          {tab === "logs" && <WorkspaceLink href={`/logs${q}`} label="Open filtered logs" sub={svc ? `${svc}, last ${win}m` : `last ${win}m`} />}
          {tab === "metrics" && <WorkspaceLink href={`/dashboard${q}`} label="Open service metrics" sub={svc ? `${svc}, last ${win}m` : `last ${win}m`} />}
        </div>
      </div>

      {/* Service dependency impact — embedded blast-radius topology */}
      <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
        <SectionLabel>Service dependency impact</SectionLabel>
        <IncidentTopology service={anchorService} minutes={win} />
      </div>

      {/* 8. COLLABORATION — not configured (honest) */}
      <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-5">
        <SectionLabel>Collaboration</SectionLabel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Owner" value={inc.assigned_to ?? "unassigned"} accent={inc.assigned_to ? "text-text-secondary" : "text-text-muted"} />
          <Fact label="Incident commander" value="not configured" accent="text-text-muted" />
          <Fact label="War room" value="not configured" accent="text-text-muted" />
        </div>
      </div>

      {/* 9. RESOLUTION — only when resolved */}
      {!firing && (
        <div className="mt-4 rounded-xl border border-status-healthy/20 bg-status-healthy/[0.04] p-5">
          <SectionLabel>Resolution</SectionLabel>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fact label="Recovery time" value={duration(inc.started_at, inc.resolved_at)} accent="text-status-healthy" />
            <Fact label="Resolved" value={inc.resolved_at ? `${since(inc.resolved_at)} ago` : "—"} />
            <Fact label="Postmortem" value="not created" accent="text-text-muted" />
          </div>
        </div>
      )}
    </Shell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{children}</h2>;
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${accent ?? "text-text-secondary"}`}>{value}</div>
    </div>
  );
}

function ImpactCard({ label, value, tone }: { label: string; value: string; tone?: "critical" | "warning" | "neutral" }) {
  const toneCls = tone === "critical" ? "text-status-critical" : tone === "warning" ? "text-status-warning" : "text-text-secondary";
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
      <div className={`text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{label}</div>
    </div>
  );
}

function WorkspaceLink({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3 transition hover:bg-surface-elevated">
      <div>
        <div className="text-sm text-text-secondary">{label}</div>
        <div className="text-[11px] text-text-muted">{sub}</div>
      </div>
      <span className="ml-auto text-text-muted">→</span>
    </Link>
  );
}
