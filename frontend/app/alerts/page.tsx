"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell, { usePoll } from "@/components/Shell";
import { sevMeta, since } from "@/lib/severity";
import { RangePicker } from "@/components/ui";
import {
  apiGet, apiSend,
  type AlertRule, type AlertRuleInput, type NotificationChannel,
  type IncidentRow, type IncidentEvidence,
} from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  latency: "Latency",
  log_spike: "Log spike",
  service_down: "Service down",
};
const KIND_UNIT: Record<string, string> = {
  error_rate: "%",
  latency: "ms",
  log_spike: "/min",
  service_down: "",
};

const EMPTY: AlertRuleInput = {
  name: "", kind: "error_rate", service: null, threshold: 5, percentile: 95,
  for_minutes: 5, min_samples: 20, enabled: true, severity: "warning",
  webhook_urls: null, channel_ids: null,
};

function FiringAlerts({ minutes, filter }: { minutes: number; filter: "all" | "info" | "warning" | "critical" | "ack" }) {
  const [alerts, setAlerts] = useState<IncidentRow[]>([]);
  const [evidence, setEvidence] = useState<Record<string, IncidentEvidence>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?status=firing&limit=50")
      .then((rows) => {
        setAlerts(rows);
        rows.forEach((r) => {
          apiGet<IncidentEvidence>(`/api/v1/alerts/incidents/${r.id}/evidence`)
            .then((e) => setEvidence((prev) => ({ ...prev, [r.id]: e })))
            .catch(() => {});
        });
      })
      .catch(() => {});
  }, []);
  usePoll(load, [], 10000);

  async function act(id: string, path: string) {
    setBusy(id);
    try { await apiSend(`/api/v1/alerts/incidents/${id}/${path}`, "POST"); load(); }
    finally { setBusy(null); }
  }

  const cutoff = Date.now() - minutes * 60_000;
  const shownAlerts = alerts
    .filter((a) => new Date(a.started_at).getTime() >= cutoff)
    .filter((a) => {
      if (filter === "all") return true;
      if (filter === "ack") return a.acknowledged_at != null;
      return a.severity === filter;
    });

  if (shownAlerts.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-300">Active alerts</h2>
        <span className="text-xs text-white/40">{shownAlerts.length} active</span>
      </div>

      <div className="space-y-2">
        {shownAlerts.map((a) => {
          const m = sevMeta(a.severity);
          const ev = evidence[a.id];
          const topSvc = ev?.affected_services?.[0];
          const topTrig = ev?.triggers?.[0];
          const ackd = a.acknowledged_at != null;
          return (
            <div key={a.id} className={`overflow-hidden rounded-xl border ${m.border} ${m.bg}`}>
              <div className="flex items-stretch">
                <span className={`w-1 shrink-0 ${m.bar}`} />
                <div className="flex-1 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.bg} ${m.text} ${m.border}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
                    </span>
                    <span className="font-medium text-white/90">{a.rule_name}</span>
                    {ackd
                      ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">acknowledged</span>
                      : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">unacknowledged</span>}
                    <span className="ml-auto text-xs text-white/45">{since(a.started_at)} ago</span>
                  </div>

                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <div><span className="text-white/35">Service: </span>
                      <span className="text-white/80">{topTrig?.service ?? topSvc?.service ?? a.service ?? "all services"}</span>
                      {topSvc && <span className="text-rose-300"> ({topSvc.error_rate}% errors)</span>}
                    </div>
                    <div><span className="text-white/35">Endpoint: </span>
                      <span className="font-mono text-sky-300/80">{topTrig?.endpoint ?? "—"}</span>
                    </div>
                    <div className="sm:col-span-2"><span className="text-white/35">Trigger: </span>
                      <span className="text-white/70">{topTrig ? `${topTrig.error} (${topTrig.occurrences}x)` : a.summary}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!ackd && (
                      <button disabled={busy === a.id} onClick={() => act(a.id, "acknowledge")}
                        className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/25">Acknowledge</button>
                    )}
                    <button disabled={busy === a.id} onClick={() => act(a.id, "resolve")}
                      className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/25">Resolve</button>
                    <a href={`/incidents/${a.id}`}
                      className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/5">Open incident →</a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuleModal({
  initial, onClose, onSaved,
}: { initial: AlertRule | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AlertRuleInput>(initial ? { ...initial } : { ...EMPTY });
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<NotificationChannel[]>("/api/v1/channels").then(setChannels).catch(() => {});
  }, []);

  function set<K extends keyof AlertRuleInput>(k: K, v: AlertRuleInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form, service: form.service || null };
      if (initial) await apiSend(`/api/v1/alerts/rules/${initial.id}`, "PATCH", body);
      else await apiSend("/api/v1/alerts/rules", "POST", body);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  const label = "mb-1 block text-xs uppercase tracking-wide text-white/40";
  const input = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0d0f] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{initial ? "Edit alert rule" : "New alert rule"}</h2>
        {err && <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{err}</p>}

        <div className="space-y-3">
          <div>
            <label className={label}>Name</label>
            <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="High error rate" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Condition</label>
              <select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as AlertRuleInput["kind"])}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Service (blank = all)</label>
              <input className={input} value={form.service ?? ""} onChange={(e) => set("service", e.target.value || null)} placeholder="payment-service" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Threshold ({KIND_UNIT[form.kind]})</label>
              <input type="number" className={input} value={form.threshold} onChange={(e) => set("threshold", Number(e.target.value))} />
            </div>
            <div>
              <label className={label}>Sustained for (min)</label>
              <input type="number" className={input} value={form.for_minutes} onChange={(e) => set("for_minutes", Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className={label}>Severity</label>
            <div className="flex gap-2">
              {(["critical", "warning", "info"] as const).map((sv) => (
                <button type="button" key={sv} onClick={() => set("severity", sv)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                    form.severity === sv
                      ? sv === "critical" ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
                        : sv === "warning" ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                        : "border-sky-400/50 bg-sky-400/15 text-sky-200"
                      : "border-white/10 text-white/50 hover:text-white"
                  }`}>
                  {sv}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={label}>Notify (notifications)</label>
            {channels.length === 0 ? (
              <p className="text-xs text-amber-300/80">No notifications yet. Add them under Manage &rarr; Notifications.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map((ch) => {
                  const selected = (form.channel_ids ?? "").split(",").filter(Boolean);
                  const on = selected.includes(ch.id);
                  return (
                    <button type="button" key={ch.id}
                      onClick={() => {
                        const next = on ? selected.filter((x) => x !== ch.id) : [...selected, ch.id];
                        set("channel_ids", next.join(",") || null);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition ${on ? "border-violet-400/50 bg-violet-500/20 text-violet-100" : "border-white/10 text-white/50 hover:text-white"}`}>
                      {ch.name} <span className="opacity-50">({ch.kind})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            Enabled
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40">
            {saving ? "Saving…" : "Save rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [alertFilter, setAlertFilter] = useState<"all" | "info" | "warning" | "critical" | "ack">("all");
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; rule: AlertRule | null }>({ open: false, rule: null });

  const load = useCallback(() => {
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?limit=200")
      .then(setIncidents).catch(() => {});
    return apiGet<AlertRule[]>("/api/v1/alerts/rules")
      .then((r) => { setRules(r); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, []);
  usePoll(load, [], 15000);

  async function toggle(rule: AlertRule) {
    await apiSend(`/api/v1/alerts/rules/${rule.id}`, "PATCH", { ...rule, enabled: !rule.enabled });
    load();
  }
  async function remove(rule: AlertRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await apiSend(`/api/v1/alerts/rules/${rule.id}`, "DELETE");
    load();
  }

  const firingCount = rules.filter((r) => r.is_firing).length;
  const enabledCount = rules.filter((r) => r.enabled).length;

  const incWindow = (i: IncidentRow) => {
    if (i.status === "firing") return true;
    const cutoff = Date.now() - minutes * 60_000;
    const st = new Date(i.started_at).getTime();
    const rs = i.resolved_at ? new Date(i.resolved_at).getTime() : 0;
    return st >= cutoff || rs >= cutoff;
  };
  const winInc = incidents.filter(incWindow);
  const firingInc = winInc.filter((i) => i.status === "firing");
  const sum = {
    total: winInc.length,
    info: firingInc.filter((i) => i.severity === "info").length,
    warning: firingInc.filter((i) => i.severity === "warning").length,
    critical: firingInc.filter((i) => i.severity === "critical").length,
    acknowledged: firingInc.filter((i) => i.acknowledged_at).length,
    resolved: winInc.filter((i) => i.status === "resolved").length,
  };

  function conditionText(r: AlertRule): string {
    if (r.kind === "service_down") return "Service is down";
    const unit = r.kind === "latency" ? ` ms (p${r.percentile})` : (KIND_UNIT[r.kind] ?? "");
    return `${KIND_LABEL[r.kind]} > ${r.threshold}${unit}`;
  }

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-white/35">Operational view</span>
        <RangePicker value={minutes} onChange={setMinutes} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <AlertStat label="Total" value={sum.total} tone="neutral" active={alertFilter === "all"} onClick={() => setAlertFilter("all")} />
        <AlertStat label="Info" value={sum.info} tone="info" active={alertFilter === "info"} onClick={() => setAlertFilter("info")} />
        <AlertStat label="Warning" value={sum.warning} tone="warning" active={alertFilter === "warning"} onClick={() => setAlertFilter("warning")} />
        <AlertStat label="Critical" value={sum.critical} tone="critical" active={alertFilter === "critical"} onClick={() => setAlertFilter("critical")} />
        <AlertStat label="Acknowledged" value={sum.acknowledged} tone="ack" active={alertFilter === "ack"} onClick={() => setAlertFilter("ack")} />
        <AlertStat label="Resolved" value={sum.resolved} tone="resolved" href="/incidents" />
      </div>

      <FiringAlerts minutes={minutes} filter={alertFilter} />

      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alert rules</h1>
          <p className="text-sm text-white/40">
            {rules.length} rule{rules.length === 1 ? "" : "s"} · {enabledCount} enabled
            {firingCount > 0 && <span className="text-rose-300"> · {firingCount} active</span>}
          </p>
        </div>
        <button onClick={() => setModal({ open: true, rule: null })}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90">+ New rule</button>
      </div>

      {err && <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}

      <div className="space-y-2">
        {rules.map((r) => {
          const m = sevMeta(r.severity);
          const hasChannels = !!(r.channel_ids && r.channel_ids.trim()) || !!(r.webhook_urls && r.webhook_urls.trim());
          return (
            <div key={r.id}
              className={`flex items-stretch overflow-hidden rounded-xl border ${r.is_firing ? "border-rose-500/40" : "border-white/10"} bg-white/[0.02]`}>
              <span className={`w-1 shrink-0 ${r.enabled ? m.bar : "bg-white/10"}`} />
              <div className="flex flex-1 flex-wrap items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.bg} ${m.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
                    </span>
                    <span className="font-medium text-white/90">{r.name}</span>
                    {r.is_firing ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />active
                      </span>
                    ) : r.enabled ? (
                      <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] text-emerald-300/90">ok</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
                    <span className="text-white/70">{conditionText(r)}</span>
                    <span>·</span>
                    <span>{r.service ?? "all services"}</span>
                    <span>·</span>
                    <span>for {r.for_minutes}m</span>
                    <span>·</span>
                    <span className={hasChannels ? "text-white/50" : "text-amber-300/80"}>
                      {hasChannels ? "notifies" : "no notifications"}
                    </span>
                    {typeof r.incident_count === "number" && r.incident_count > 0 && (
                      <>
                        <span>·</span>
                        <span>{r.incident_count} incident{r.incident_count === 1 ? "" : "s"}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(r)}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${r.enabled ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "bg-white/10 text-white/40 hover:bg-white/15"}`}>
                    {r.enabled ? "enabled" : "disabled"}
                  </button>
                  <button onClick={() => setModal({ open: true, rule: r })}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5">Edit</button>
                  <button onClick={() => remove(r)}
                    className="rounded-lg border border-rose-400/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10">Delete</button>
                </div>
              </div>
            </div>
          );
        })}
        {rules.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] py-10 text-center text-sm text-white/40">
            No rules yet. Create one to start alerting.
          </div>
        )}
      </div>

      {modal.open && (
        <RuleModal
          initial={modal.rule}
          onClose={() => setModal({ open: false, rule: null })}
          onSaved={() => { setModal({ open: false, rule: null }); load(); }}
        />
      )}
    </Shell>
  );
}

function AlertStat({ label, value, tone, active, onClick, href }: {
  label: string; value: number;
  tone: "critical" | "warning" | "info" | "ack" | "resolved" | "neutral";
  active?: boolean; onClick?: () => void; href?: string;
}) {
  const toneCls =
    tone === "critical" ? "border-rose-500/30 text-rose-300"
    : tone === "warning" ? "border-amber-400/30 text-amber-300"
    : tone === "info" ? "border-sky-400/30 text-sky-300"
    : tone === "ack" ? "border-violet-400/30 text-violet-300"
    : tone === "resolved" ? "border-emerald-400/30 text-emerald-300"
    : "border-white/15 text-white/70";
  const cls = `block rounded-xl border bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.05] ${toneCls} ${active ? "ring-2 ring-white/30" : ""}`;
  const inner = (
    <>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
    </>
  );
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}
