"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { apiGet, apiSend } from "@/lib/api";
import { useRole, canManage } from "@/lib/role";

type ServiceRow = {
  name: string;
  discovered: boolean;
  registered: boolean;
  slo_count: number;
  id: string | null;
  display_name: string | null;
  description: string | null;
  owner: string | null;
  team: string | null;
  tags: string | null;
  criticality: string | null;
  sla_target_pct: number | null;
  sla_window_days: number | null;
  sla_metric: string | null;
};

type Form = {
  name: string;
  display_name: string;
  description: string;
  owner: string;
  team: string;
  tags: string;
  criticality: string;
  sla_target_pct: string;
  sla_window_days: string;
  sla_metric: string;
};

const CRIT = [
  { v: "tier1", label: "Tier 1 · Mission critical" },
  { v: "tier2", label: "Tier 2 · High" },
  { v: "tier3", label: "Tier 3 · Medium" },
  { v: "tier4", label: "Tier 4 · Low" },
];
const CRIT_LABEL: Record<string, string> = { tier1: "Tier 1", tier2: "Tier 2", tier3: "Tier 3", tier4: "Tier 4" };
const CRIT_STYLE: Record<string, string> = {
  tier1: "border-status-critical/40 bg-status-critical/10 text-status-critical",
  tier2: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  tier3: "border-status-info/40 bg-status-info/10 text-status-info",
  tier4: "border-border bg-surface-elevated text-text-muted",
};

const BLANK: Form = {
  name: "", display_name: "", description: "", owner: "", team: "",
  tags: "", criticality: "tier3", sla_target_pct: "", sla_window_days: "", sla_metric: "",
};

function fromRow(r: ServiceRow): Form {
  return {
    name: r.name,
    display_name: r.display_name ?? "",
    description: r.description ?? "",
    owner: r.owner ?? "",
    team: r.team ?? "",
    tags: r.tags ?? "",
    criticality: r.criticality ?? "tier3",
    sla_target_pct: r.sla_target_pct != null ? String(r.sla_target_pct) : "",
    sla_window_days: r.sla_window_days != null ? String(r.sla_window_days) : "",
    sla_metric: r.sla_metric ?? "",
  };
}

export default function ServicesPage() {
  const role = useRole();
  const admin = canManage(role);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceRow | null>(null); // the row being curated/edited
  const [isNew, setIsNew] = useState(false); // creating a brand-new (pre-registered) service
  const [form, setForm] = useState<Form>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiGet<ServiceRow[]>("/api/v1/services")
      .then(setRows)
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(r: ServiceRow) {
    setEditing(r);
    setIsNew(false);
    setForm(fromRow(r));
  }
  function openNew() {
    setEditing(null);
    setIsNew(true);
    setForm(BLANK);
  }
  function close() {
    setEditing(null);
    setIsNew(false);
  }

  function save() {
    setSaving(true);
    setErr(null);
    const body: Record<string, unknown> = {
      display_name: form.display_name || null,
      description: form.description || null,
      owner: form.owner || null,
      team: form.team || null,
      tags: form.tags || null,
      criticality: form.criticality,
      sla_target_pct: form.sla_target_pct === "" ? null : parseFloat(form.sla_target_pct),
      sla_window_days: form.sla_window_days === "" ? null : parseInt(form.sla_window_days, 10),
      sla_metric: form.sla_metric || null,
    };
    const existingId = editing?.id ?? null;
    const req = existingId
      ? apiSend(`/api/v1/services/${existingId}`, "PATCH", body)
      : apiSend("/api/v1/services", "POST", { ...body, name: (isNew ? form.name : editing?.name) || "" });
    req
      .then(() => { close(); load(); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setSaving(false));
  }

  function remove(r: ServiceRow) {
    if (!r.id) return;
    setErr(null);
    apiSend<void>(`/api/v1/services/${r.id}`, "DELETE")
      .then(() => { close(); load(); })
      .catch((e: Error) => setErr(e.message));
  }

  const field = "w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <Shell>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-text-muted">
            Services discovered from telemetry, enriched with ownership, criticality, and an SLA
            commitment. The SLA is the reliability promise; the SLOs attached to a service are how
            it is measured.
          </p>
        </div>
        {admin && (
          <button
            onClick={openNew}
            className="shrink-0 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent transition hover:bg-accent/25"
          >
            Add service
          </button>
        )}
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-elevated">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
              <th className="px-4 py-2.5 font-medium">Service</th>
              <th className="px-4 py-2.5 font-medium">Criticality</th>
              <th className="px-4 py-2.5 font-medium">Owner / Team</th>
              <th className="px-4 py-2.5 font-medium">SLA commitment</th>
              <th className="px-4 py-2.5 font-medium">SLOs</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              {admin && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-border/60 last:border-0 hover:bg-surface-hover/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-text-primary">{r.display_name || r.name}</div>
                  {r.display_name && <div className="font-mono text-[11px] text-text-muted">{r.name}</div>}
                </td>
                <td className="px-4 py-3">
                  {r.registered && r.criticality ? (
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${CRIT_STYLE[r.criticality] ?? CRIT_STYLE.tier4}`}>
                      {CRIT_LABEL[r.criticality] ?? r.criticality}
                    </span>
                  ) : (
                    <span className="text-text-muted">Not set</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {r.owner || r.team ? (
                    <span>{r.owner || "—"}{r.team ? <span className="text-text-muted"> / {r.team}</span> : null}</span>
                  ) : (
                    <span className="text-text-muted">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {r.sla_target_pct != null ? (
                    <span>
                      {r.sla_target_pct}%{r.sla_window_days ? <span className="text-text-muted"> / {r.sla_window_days}d</span> : null}
                      {r.sla_metric ? <span className="text-text-muted"> {"·"} {r.sla_metric}</span> : null}
                    </span>
                  ) : (
                    <span className="text-text-muted">Not set</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">{r.slo_count}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {r.registered && (
                      <span className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">Curated</span>
                    )}
                    {r.discovered ? (
                      <span className="inline-flex rounded-full border border-status-healthy/40 bg-status-healthy/10 px-2 py-0.5 text-[11px] text-status-healthy">Live</span>
                    ) : (
                      <span className="inline-flex rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-[11px] text-text-muted">No telemetry</span>
                    )}
                  </div>
                </td>
                {admin && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(r)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition hover:bg-surface-elevated hover:text-text-primary"
                    >
                      {r.registered ? "Edit" : "Curate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={admin ? 7 : 6} className="px-4 py-8 text-center text-sm text-text-muted">
                  No services discovered yet. Point telemetry at the gateway, or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || isNew) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface-card p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">
                {isNew ? "Add service" : editing?.registered ? "Edit service" : "Curate service"}
              </h2>
              <button onClick={close} className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated">Close</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-text-muted">Service name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!isNew}
                  placeholder="checkout-service"
                  className={`${field} ${!isNew ? "opacity-60" : ""} font-mono`}
                />
                {!isNew && <p className="mt-1 text-[11px] text-text-muted">Name matches the telemetry ServiceName and cannot be changed.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Display name</label>
                  <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={field} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Criticality</label>
                  <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} className={field}>
                    {CRIT.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Owner</label>
                  <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} className={field} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Team</label>
                  <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} className={field} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-muted">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={field} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-muted">Tags (comma separated)</label>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className={field} />
              </div>

              <div className="rounded-lg border border-border bg-surface-elevated p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">SLA commitment</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Target %</label>
                    <input value={form.sla_target_pct} onChange={(e) => setForm({ ...form, sla_target_pct: e.target.value })} placeholder="99.9" className={field} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Window (days)</label>
                    <input value={form.sla_window_days} onChange={(e) => setForm({ ...form, sla_window_days: e.target.value })} placeholder="30" className={field} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Metric</label>
                    <select value={form.sla_metric} onChange={(e) => setForm({ ...form, sla_metric: e.target.value })} className={field}>
                      <option value="">None</option>
                      <option value="availability">Availability</option>
                      <option value="latency">Latency</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              {editing?.id ? (
                <button
                  onClick={() => remove(editing)}
                  className="rounded-lg border border-status-critical/30 px-3 py-1.5 text-sm text-status-critical transition hover:bg-status-critical/15"
                >
                  Remove curation
                </button>
              ) : <span />}
              <button
                onClick={save}
                disabled={saving || (isNew && !form.name.trim())}
                className="rounded-lg border border-accent/40 bg-accent/15 px-4 py-1.5 text-sm text-accent transition hover:bg-accent/25 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
