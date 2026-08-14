"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell, { usePoll } from "@/components/Shell";
import ServiceSelect from "@/components/ServiceSelect";
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

// Alert types the evaluator actually supports today, with operator-facing
// descriptions. Only these four are exposed so no alert is created that
// silently never fires.
const KIND_META: Array<{ value: string; label: string; desc: string }> = [
  { value: "error_rate", label: "Error Rate", desc: "Fires when the share of errored requests exceeds the threshold." },
  { value: "latency", label: "Latency", desc: "Fires when the latency percentile exceeds the threshold (ms)." },
  { value: "log_spike", label: "Log Spike", desc: "Fires when log volume per minute exceeds the threshold." },
  { value: "service_down", label: "Availability", desc: "Fires when the service stops producing traffic." },
];

const EMPTY: AlertRuleInput = {
  name: "", kind: "error_rate", service: null, threshold: 5, percentile: 95,
  for_minutes: 5, min_samples: 20, enabled: true, severity: "warning",
  webhook_urls: null, channel_ids: null,
};

function fmtDur(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function KpiCell({ label, value, tone, active, onClick, href }: {
  label: string; value: number | string;
  tone: "critical" | "high" | "warning" | "info" | "ack" | "resolved" | "neutral";
  active?: boolean; onClick?: () => void; href?: string;
}) {
  const toneCls =
    tone === "critical" ? "text-rose-300" : tone === "high" ? "text-orange-300"
    : tone === "warning" ? "text-amber-300"
    : tone === "info" ? "text-sky-300" : tone === "ack" ? "text-violet-300"
    : tone === "resolved" ? "text-emerald-300" : "text-white/85";
  const inner = (
    <>
      <div className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">{label}</div>
    </>
  );
  const base = `bg-[#0d0d12] px-4 py-3 text-left transition ${active ? "ring-1 ring-inset ring-white/25" : ""} ${(onClick || href) ? "hover:bg-white/[0.03]" : ""}`;
  if (href) return <a href={href} className={base + " block"}>{inner}</a>;
  if (onClick) return <button onClick={onClick} className={base + " block w-full"}>{inner}</button>;
  return <div className={base}>{inner}</div>;
}

function ruleDef(r: AlertRule): string {
  if (r.kind === "service_down") return "Service is down";
  const unit = r.kind === "latency" ? ` ms (p${r.percentile})` : (KIND_UNIT[r.kind] ?? "");
  return `${KIND_LABEL[r.kind]} > ${r.threshold}${unit}`;
}

function notifyText(r: AlertRule): string {
  const chans = (r.channel_ids ?? "").split(",").filter(Boolean).length;
  const hooks = (r.webhook_urls ?? "").split(",").filter(Boolean).length;
  const n = chans + hooks;
  return n === 0 ? "no notifications" : n === 1 ? "notifies 1 channel" : `notifies ${n} channels`;
}

function FiringAlerts({ minutes, filter, rules }: {
  minutes: number;
  filter: "all" | "info" | "warning" | "high" | "critical" | "ack";
  rules: AlertRule[];
}) {
  const [alerts, setAlerts] = useState<IncidentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?status=firing&limit=50")
      .then(setAlerts).catch(() => {});
  }, []);
  usePoll(load, [], 10000);
  async function act(id: string, path: string) {
    setBusy(id);
    try { await apiSend(`/api/v1/alerts/incidents/${id}/${path}`, "POST"); load(); }
    catch { /* ignore */ } finally { setBusy(null); }
  }

  const cutoff = Date.now() - minutes * 60_000;
  const shown = alerts
    .filter((a) => new Date(a.started_at).getTime() >= cutoff)
    .filter((a) => {
      if (filter === "all") return true;
      if (filter === "ack") return a.acknowledged_at != null;
      return a.severity === filter;
    });

  const ruleFor = (a: IncidentRow) => rules.find((r) => r.id === a.rule_id);
  const lanes: Array<"critical" | "high" | "warning" | "info"> = ["critical", "high", "warning", "info"];
  const laneMeta: Record<string, { label: string; text: string; rule: string }> = {
    critical: { label: "Critical", text: "text-rose-300", rule: "bg-rose-500/40" },
    high: { label: "High", text: "text-orange-300", rule: "bg-orange-500/40" },
    warning: { label: "Warning", text: "text-amber-300", rule: "bg-amber-400/40" },
    info: { label: "Info", text: "text-sky-300", rule: "bg-sky-400/40" },
  };

  if (shown.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">
        {filter === "all" ? "No alerts firing right now." : `No ${filter === "ack" ? "acknowledged" : filter} alerts firing right now.`}
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-6">
      {lanes.map((lane) => {
        const laneAlerts = shown.filter((a) => a.severity === lane);
        if (laneAlerts.length === 0) return null;
        const lm = laneMeta[lane];
        return (
          <div key={lane}>
            <div className="mb-2 flex items-center gap-3">
              <span className={`text-xs font-bold uppercase tracking-[0.2em] ${lm.text}`}>{lm.label}</span>
              <span className="text-[11px] text-white/35">{laneAlerts.length}</span>
              <span className={`h-px flex-1 ${lm.rule}`} />
            </div>
            <div className="space-y-2">
              {laneAlerts.map((a) => {
                const r = ruleFor(a);
                const ackd = a.acknowledged_at != null;
                const unit = a.kind === "error_rate" ? "%" : a.kind.startsWith("latency") ? "ms" : "";
                return (
                  <div key={a.id} className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${lm.rule.replace("/40", "")}`} />
                      <span className="font-medium text-white/90">{a.rule_name}</span>
                      <span className="text-xs text-white/45">{a.service ?? "all services"}</span>
                      {ackd
                        ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">Acknowledged</span>
                        : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">Unacknowledged</span>}
                      <span className="ml-auto text-xs text-white/45">open {since(a.started_at)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                      <span>
                        <span className="text-white/35">Current: </span>
                        <span className="font-semibold text-rose-300">{a.observed_value}{unit}</span>
                      </span>
                      <span>
                        <span className="text-white/35">Threshold: </span>
                        <span className="text-white/70">{a.threshold}{unit}</span>
                      </span>
                      {r && <span><span className="text-white/35">Sustained: </span><span className="text-white/70">{r.for_minutes}m</span></span>}
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
                );
              })}
            </div>
          </div>
        );
      })}
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
              <label className={label}>Alert Type</label>
              <select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as AlertRuleInput["kind"])}>
                {KIND_META.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] leading-snug text-white/40">
                {KIND_META.find((m) => m.value === form.kind)?.desc}
              </p>
            </div>
            <div>
              <label className={label}>Service</label>
              <ServiceSelect value={form.service ?? null} onChange={(svc) => set("service", svc)} />
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
              {(["critical", "high", "warning", "info"] as const).map((sv) => (
                <button type="button" key={sv} onClick={() => set("severity", sv)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                    form.severity === sv
                      ? sv === "critical" ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
                        : sv === "high" ? "border-orange-500/50 bg-orange-500/15 text-orange-200"
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
  const [metrics, setMetrics] = useState<{ mtta_seconds: number | null; mttr_seconds: number | null } | null>(null);
  const [alertFilter, setAlertFilter] = useState<"all" | "info" | "warning" | "high" | "critical" | "ack">("all");
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; rule: AlertRule | null }>({ open: false, rule: null });

  const load = useCallback(() => {
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?limit=200")
      .then(setIncidents).catch(() => {});
    apiGet<{ mtta_seconds: number | null; mttr_seconds: number | null }>("/api/v1/alerts/metrics")
      .then(setMetrics).catch(() => {});
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
    high: firingInc.filter((i) => i.severity === "high").length,
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
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <h1 className="text-sm font-semibold uppercase tracking-wider text-white/80">Alert Operations Center</h1>
          </div>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
        <div className="grid grid-cols-4 gap-px bg-white/5 sm:grid-cols-7">
          <KpiCell label="Critical" value={sum.critical} tone="critical" active={alertFilter === "critical"} onClick={() => setAlertFilter(alertFilter === "critical" ? "all" : "critical")} />
          <KpiCell label="High" value={sum.high} tone="high" active={alertFilter === "high"} onClick={() => setAlertFilter(alertFilter === "high" ? "all" : "high")} />
          <KpiCell label="Warning" value={sum.warning} tone="warning" active={alertFilter === "warning"} onClick={() => setAlertFilter(alertFilter === "warning" ? "all" : "warning")} />
          <KpiCell label="Info" value={sum.info} tone="info" active={alertFilter === "info"} onClick={() => setAlertFilter(alertFilter === "info" ? "all" : "info")} />
          <KpiCell label="Open" value={firingInc.length} tone="neutral" active={alertFilter === "all"} onClick={() => setAlertFilter("all")} />
          <KpiCell label="Acknowledged" value={sum.acknowledged} tone="ack" active={alertFilter === "ack"} onClick={() => setAlertFilter(alertFilter === "ack" ? "all" : "ack")} />
          <KpiCell label="Resolved" value={sum.resolved} tone="resolved" />
        </div>
      </div>

      <FiringAlerts minutes={minutes} filter={alertFilter} rules={rules} />

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
  tone: "critical" | "high" | "warning" | "info" | "ack" | "resolved" | "neutral";
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
