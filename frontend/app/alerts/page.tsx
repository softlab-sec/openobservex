"use client";

import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { Card } from "@/components/ui";
import { apiGet, apiSend, type AlertRule, type AlertRuleInput } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  latency: "Latency",
  log_spike: "Log spike",
  service_down: "Service down",
};
const KIND_UNIT: Record<string, string> = { error_rate: "%", latency: "ms", log_spike: "logs", service_down: "" };
const EMPTY: AlertRuleInput = {
  name: "", kind: "error_rate", service: null, threshold: 5, percentile: 95,
  for_minutes: 5, min_samples: 20, enabled: true, webhook_urls: null,
};

function RuleModal({ initial, onClose, onSaved }: { initial: AlertRule | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AlertRuleInput>(initial ? { ...initial } : { ...EMPTY });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  function set<K extends keyof AlertRuleInput>(k: K, v: AlertRuleInput[K]) { setForm((f) => ({ ...f, [k]: v })); }
  async function save() {
    setSaving(true); setErr(null);
    try {
      const body = { ...form, service: form.service || null, webhook_urls: form.webhook_urls || null };
      if (initial) await apiSend(`/api/v1/alerts/rules/${initial.id}`, "PATCH", body);
      else await apiSend("/api/v1/alerts/rules", "POST", body);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  const input = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
  const label = "mb-1 block text-xs uppercase tracking-wider text-white/40";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1219] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{initial ? "Edit rule" : "New alert rule"}</h2>
        <div className="space-y-4">
          <div><label className={label}>Name</label>
            <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="High error rate" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Condition</label>
              <select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as AlertRuleInput["kind"])}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className={label}>Service (blank = all)</label>
              <input className={input} value={form.service ?? ""} onChange={(e) => set("service", e.target.value || null)} placeholder="payment-service" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {form.kind !== "service_down" && (
              <div><label className={label}>Threshold ({KIND_UNIT[form.kind]})</label>
                <input type="number" className={input} value={form.threshold} onChange={(e) => set("threshold", Number(e.target.value))} /></div>
            )}
            {form.kind === "latency" && (
              <div><label className={label}>Percentile</label>
                <select className={input} value={form.percentile} onChange={(e) => set("percentile", Number(e.target.value))}>
                  <option value={95}>p95</option><option value={99}>p99</option>
                </select></div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Sustained for (min)</label>
              <input type="number" className={input} value={form.for_minutes} onChange={(e) => set("for_minutes", Number(e.target.value))} /></div>
            <div><label className={label}>Min samples</label>
              <input type="number" className={input} value={form.min_samples} onChange={(e) => set("min_samples", Number(e.target.value))} /></div>
          </div>
          <div><label className={label}>Webhook URLs (comma-separated)</label>
            <input className={input} value={form.webhook_urls ?? ""} onChange={(e) => set("webhook_urls", e.target.value || null)} placeholder="https://hooks.slack.com/services/..." /></div>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled
          </label>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5">Cancel</button>
          <button onClick={save} disabled={saving || !form.name} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
            {saving ? "Saving..." : "Save rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; rule: AlertRule | null }>({ open: false, rule: null });
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const load = useCallback(() => apiGet<AlertRule[]>("/api/v1/alerts/rules").then((r) => { setRules(r); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  usePoll(load, [], 15000);
  async function toggle(rule: AlertRule) { await apiSend(`/api/v1/alerts/rules/${rule.id}`, "PATCH", { ...rule, enabled: !rule.enabled }); load(); }
  async function remove(rule: AlertRule) { if (!confirm(`Delete rule "${rule.name}"?`)) return; await apiSend(`/api/v1/alerts/rules/${rule.id}`, "DELETE"); load(); }
  async function test(rule: AlertRule) {
    setTestMsg(null);
    try {
      const r = await apiSend<{ sent: Record<string, boolean> }>(`/api/v1/alerts/rules/${rule.id}/test`, "POST");
      setTestMsg(Object.values(r.sent).every(Boolean) ? `Test sent for "${rule.name}"` : `Some webhooks failed for "${rule.name}"`);
    } catch (e) { setTestMsg((e as Error).message); }
  }
  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-xl font-semibold tracking-tight">Alert rules</h1>
          <p className="text-sm text-white/40">Conditions evaluated every 60s against live telemetry.</p></div>
        <button onClick={() => setModal({ open: true, rule: null })} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">+ New rule</button>
      </div>
      {err && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}
      {testMsg && <p className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">{testMsg}</p>}
      <Card>
        <table className="w-full text-left text-sm">
          <thead className="text-white/40"><tr>
            <th className="py-2 font-medium">Name</th><th className="py-2 font-medium">Condition</th>
            <th className="py-2 font-medium">Scope</th><th className="py-2 font-medium">For</th>
            <th className="py-2 font-medium">Status</th><th className="py-2 font-medium text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="py-3 font-medium text-white/90">{r.name}</td>
                <td className="py-3 text-white/70">{KIND_LABEL[r.kind]}
                  {r.kind !== "service_down" && <span className="text-white/45"> &gt; {r.threshold}{r.kind === "latency" ? `ms (p${r.percentile})` : KIND_UNIT[r.kind]}</span>}</td>
                <td className="py-3 text-white/60">{r.service ?? "all services"}</td>
                <td className="py-3 tabular-nums text-white/60">{r.for_minutes}m</td>
                <td className="py-3">
                  <button onClick={() => toggle(r)} className={`rounded-full px-2 py-0.5 text-xs ${r.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/40"}`}>
                    {r.enabled ? "enabled" : "disabled"}</button></td>
                <td className="py-3"><div className="flex justify-end gap-2">
                  {r.webhook_urls && <button onClick={() => test(r)} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/5">Test</button>}
                  <button onClick={() => setModal({ open: true, rule: r })} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/5">Edit</button>
                  <button onClick={() => remove(r)} className="rounded-lg border border-red-400/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">Delete</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && <p className="py-8 text-center text-sm text-white/30">No rules yet. Create one to start alerting.</p>}
      </Card>
      {modal.open && <RuleModal initial={modal.rule} onClose={() => setModal({ open: false, rule: null })} onSaved={() => { setModal({ open: false, rule: null }); load(); }} />}
    </Shell>
  );
}
