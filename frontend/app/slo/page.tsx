"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import Link from "next/link";
import Combobox from "@/components/Combobox";
import { useRole, canOperate, canManage } from "@/lib/role";
import {
  apiGet,
  apiSend,
  type Slo,
  type SloInput,
  type SloInventory,
} from "@/lib/api";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-border";
const labelCls = "mb-1 block text-xs font-medium text-text-muted";

type TargetKind = "service" | "api" | "endpoint" | "infrastructure";
const KINDS: { key: TargetKind; label: string }[] = [
  { key: "service", label: "Service" },
  { key: "api", label: "API" },
  { key: "endpoint", label: "Endpoint" },
  { key: "infrastructure", label: "Infrastructure" },
];

function budgetColor(pct: number | null): string {
  if (pct === null) return "bg-surface-hover";
  if (pct <= 0) return "bg-status-critical";
  if (pct < 25) return "bg-status-warning";
  return "bg-status-healthy";
}

// The target IS the identity of an SLO. Render it consistently everywhere.
function targetLine(slo: Slo): string {
  const kind = slo.target_kind;
  if (kind === "infrastructure") return `infrastructure · ${slo.target_ref ?? "unknown"}`;
  if (kind === "service") return `service · ${slo.service ?? slo.target_ref ?? "unknown"}`;
  return `${kind} · ${slo.target_ref ?? "unknown"} on ${slo.service ?? "unknown"}`;
}

function sliLabel(slo: Slo): string {
  return slo.sli_type === "latency"
    ? `Latency · under ${slo.latency_threshold_ms}ms`
    : "Availability";
}

// Overflow action menu. Floats above sibling cards; closes on outside-click / Escape.
function CardMenu({
  slo,
  role,
  onEdit,
  onClone,
  onEvaluate,
  onToggle,
  onDelete,
}: {
  slo: Slo;
  role: string | null;
  onEdit: (slo: Slo) => void;
  onClone: (id: string) => void;
  onEvaluate: (id: string) => void;
  onToggle: (slo: Slo) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canOp = canOperate(role);
  const canMg = canManage(role);
  if (!canOp && !canMg) return null;

  const item =
    "flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition hover:bg-surface-hover";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
      >
        <span className="text-lg leading-none">⋮</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-border bg-surface-card py-1 shadow-xl shadow-black/40"
        >
          {canOp && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onEdit(slo); }}>
              Edit
            </button>
          )}
          {canOp && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onClone(slo.id); }}>
              Clone
            </button>
          )}
          {canOp && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onEvaluate(slo.id); }}>
              Refresh
            </button>
          )}
          {canMg && (
            <>
              <div className="my-1 border-t border-border" />
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onToggle(slo); }}>
                {slo.enabled ? "Disable" : "Enable"}
              </button>
              <div className="my-1 border-t border-border" />
              <button
                role="menuitem"
                className="flex w-full items-center px-3 py-2 text-left text-xs text-status-critical/90 transition hover:bg-status-critical/10"
                onClick={() => { setOpen(false); onDelete(slo.id); }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SloCard({
  slo,
  role,
  onEdit,
  onClone,
  onEvaluate,
  onToggle,
  onDelete,
}: {
  slo: Slo;
  role: string | null;
  onEdit: (slo: Slo) => void;
  onClone: (id: string) => void;
  onEvaluate: (id: string) => void;
  onToggle: (slo: Slo) => void;
  onDelete: (id: string) => void;
}) {
  const meeting = slo.is_meeting;
  const sli = slo.current_sli;
  const budget = slo.budget_remaining_pct;
  const barWidth = budget === null ? 0 : Math.max(0, Math.min(100, budget));
  const tags = (slo.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div
      className={`rounded-xl border p-5 transition ${
        slo.enabled
          ? "border-border bg-surface-card"
          : "border-border-subtle bg-surface-card opacity-60"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/slo/${slo.id}`} className="truncate font-medium text-text-primary transition hover:text-accent hover:underline">{slo.name}</Link>
            {!slo.enabled && (
              <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                Disabled
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-text-secondary">{targetLine(slo)}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {sliLabel(slo)} · {slo.window_days}d window
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              meeting === null
                ? "bg-surface-hover text-text-muted"
                : meeting
                  ? "bg-status-healthy/15 text-status-healthy"
                  : "bg-status-critical/15 text-status-critical"
            }`}
          >
            {meeting === null ? "Not evaluated" : meeting ? "Meeting" : "Breaching"}
          </span>
          <CardMenu
            slo={slo}
            role={role}
            onEdit={onEdit}
            onClone={onClone}
            onEvaluate={onEvaluate}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        </div>
      </div>

      {(slo.owner || slo.team || tags.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {slo.owner && <span>Owner: {slo.owner}</span>}
          {slo.team && <span>Team: {slo.team}</span>}
          {tags.map((t) => (
            <span key={t} className="rounded bg-surface-elevated px-1.5 py-0.5 text-text-secondary">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-baseline gap-3">
        <span
          className={`text-3xl font-semibold tabular-nums ${
            meeting === null ? "text-text-muted" : meeting ? "text-status-healthy" : "text-status-critical"
          }`}
        >
          {sli === null ? "--" : `${sli.toFixed(3)}%`}
        </span>
        <span className="text-sm text-text-muted">target {slo.target}%</span>
      </div>

      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        <span>Error budget remaining</span>
        <span className="tabular-nums">{budget === null ? "--" : `${budget.toFixed(1)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={`h-full rounded-full transition-all ${budgetColor(budget)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs">
        {slo.burn_rate !== null && (
          <span
            className={`rounded px-2 py-0.5 tabular-nums ${
              slo.burn_rate > 1 ? "bg-status-critical/10 text-status-critical" : "bg-surface-elevated text-text-secondary"
            }`}
            title="Burn rate: how fast the budget is being consumed (1.0 = sustainable)"
          >
            {slo.burn_rate.toFixed(1)}x burn
          </span>
        )}
        {slo.total_events !== null && (
          <span className="text-text-muted">{slo.total_events.toLocaleString()} requests</span>
        )}
      </div>
    </div>
  );
}

type FormState = {
  target_kind: TargetKind;
  service: string;
  target_ref: string;
  host: string;
  name: string;
  sli_type: "availability" | "latency";
  target: number;
  window_days: number;
  latency_threshold_ms: number | null;
  owner: string;
  team: string;
  tags: string;
  description: string;
};

const EMPTY_FORM: FormState = {
  target_kind: "service",
  service: "",
  target_ref: "",
  host: "",
  name: "",
  sli_type: "availability",
  target: 99.9,
  window_days: 30,
  latency_threshold_ms: null,
  owner: "",
  team: "",
  tags: "",
  description: "",
};

export default function SloPage() {
  const ctxRole = useRole();
  const [meRole, setMeRole] = useState<string | undefined>(undefined);
  // The shared role context can be undefined if Shell's /me hasn't resolved for
  // this view; fetch it directly so action gating is reliable on this page.
  useEffect(() => {
    if (ctxRole) { setMeRole(ctxRole); return; }
    apiGet<{ role?: string }>("/api/v1/auth/me")
      .then((m) => setMeRole(m.role))
      .catch(() => {});
  }, [ctxRole]);
  const role = ctxRole ?? meRole ?? null;

  const [slos, setSlos] = useState<Slo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [inventory, setInventory] = useState<SloInventory | null>(null);
  const [invErr, setInvErr] = useState<string | null>(null);

  const load = useCallback(() => {
    return apiGet<Slo[]>("/api/v1/slos")
      .then((d) => {
        setSlos(d);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  usePoll(load, []);

  useEffect(() => {
    if (showForm && !inventory) {
      apiGet<SloInventory>("/api/v1/slos/inventory")
        .then((d) => {
          setInventory(d);
          setInvErr(null);
        })
        .catch((e: Error) => setInvErr(e.message));
    }
  }, [showForm, inventory]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  }
  function openCreate() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  }
  function startEdit(slo: Slo) {
    const kind = (slo.target_kind ?? "service") as TargetKind;
    setForm({
      target_kind: kind,
      service: slo.service ?? "",
      target_ref: kind === "service" ? "" : (slo.target_ref ?? ""),
      host: kind === "infrastructure" ? (slo.target_ref ?? "") : "",
      name: slo.name,
      sli_type: slo.sli_type,
      target: slo.target,
      window_days: slo.window_days,
      latency_threshold_ms: slo.latency_threshold_ms ?? null,
      owner: slo.owner ?? "",
      team: slo.team ?? "",
      tags: slo.tags ?? "",
      description: slo.description ?? "",
    });
    setEditingId(slo.id);
    setShowForm(true);
  }

  // Escape closes the modal.
  useEffect(() => {
    if (!showForm) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeForm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm]);

  const services = inventory?.services ?? [];
  const hosts = inventory?.infrastructure ?? [];
  const endpointsForService = useMemo(() => {
    if (!inventory || !form.service) return [];
    return inventory.endpoints
      .filter((e) => e.service === form.service)
      .map((e) => e.endpoint);
  }, [inventory, form.service]);

  function setKind(kind: TargetKind) {
    setForm((f) => ({ ...f, target_kind: kind, service: "", target_ref: "", host: "" }));
  }
  function setService(svc: string) {
    setForm((f) => ({ ...f, service: svc, target_ref: "" }));
  }

  const resolvedTarget = useMemo(() => {
    const k = form.target_kind;
    if (k === "service") return form.service ? `service · ${form.service}` : null;
    if (k === "infrastructure") return form.host ? `infrastructure · ${form.host}` : null;
    if (form.service && form.target_ref) return `${k} · ${form.target_ref} on ${form.service}`;
    return null;
  }, [form.target_kind, form.service, form.target_ref, form.host]);

  const targetValid = resolvedTarget !== null;
  const latencyValid =
    form.sli_type !== "latency" || (form.latency_threshold_ms != null && form.latency_threshold_ms > 0);
  const canSubmit =
    form.name.trim().length > 0 &&
    targetValid &&
    latencyValid &&
    form.target >= 0 &&
    form.target <= 100;

  async function submit() {
    setErr(null);
    try {
      const k = form.target_kind;
      const service = k === "infrastructure" ? null : form.service.trim() || null;
      const target_ref =
        k === "infrastructure"
          ? form.host.trim()
          : k === "service"
            ? form.service.trim()
            : form.target_ref.trim();

      const payload: SloInput = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        owner: form.owner.trim() || null,
        team: form.team.trim() || null,
        tags: form.tags.trim() || null,
        sli_type: form.sli_type,
        target_kind: k,
        service,
        target_ref: target_ref || null,
        target: form.target,
        window_days: form.window_days,
        latency_threshold_ms: form.sli_type === "latency" ? form.latency_threshold_ms : null,
      };

      if (editingId) {
        await apiSend<Slo>(`/api/v1/slos/${editingId}`, "PATCH", payload);
        await apiSend<Slo>(`/api/v1/slos/${editingId}/evaluate`, "POST");
      } else {
        const created = await apiSend<Slo>("/api/v1/slos", "POST", payload);
        await apiSend<Slo>(`/api/v1/slos/${created.id}/evaluate`, "POST");
      }
      closeForm();
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function evaluate(id: string) {
    try {
      await apiSend<Slo>(`/api/v1/slos/${id}/evaluate`, "POST");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function clone(id: string) {
    try {
      await apiSend<Slo>(`/api/v1/slos/${id}/clone`, "POST");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function toggle(slo: Slo) {
    if (slo.enabled && !confirm(`Disable "${slo.name}"? It will stop being evaluated.`)) return;
    try {
      await apiSend<Slo>(`/api/v1/slos/${slo.id}`, "PATCH", { enabled: !slo.enabled });
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this SLO? This cannot be undone.")) return;
    try {
      await apiSend(`/api/v1/slos/${id}`, "DELETE");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const showServicePicker = form.target_kind !== "infrastructure";
  const showEndpointPicker = form.target_kind === "api" || form.target_kind === "endpoint";

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service Level Objectives</h1>
          <p className="text-sm text-text-muted">Track reliability targets and error budgets</p>
        </div>
        {canOperate(role) && (
          <button
            onClick={openCreate}
            className="rounded-lg bg-surface-card px-3 py-1.5 text-sm font-medium text-text-primary transition hover:bg-surface-hover"
          >
            New SLO
          </button>
        )}
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {err}
        </p>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-surface-elevated p-4 backdrop-blur-sm sm:p-8"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <div className="my-4 w-full max-w-3xl rounded-2xl border border-border bg-surface-card p-6 shadow-2xl shadow-black/50">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {editingId ? "Edit SLO" : "Create SLO Profile"}
                </h2>
                <p className="text-xs text-text-muted">
                  {editingId ? "Editing an existing SLO" : "Define a reliability target on a service, API, endpoint, or host"}
                </p>
              </div>
              <button
                onClick={closeForm}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover"
              >
                Cancel
              </button>
            </div>

            {invErr ? (
              <p className="rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
                Could not load inventory: {invErr}
              </p>
            ) : !inventory ? (
              <p className="py-6 text-center text-sm text-text-muted">Loading inventory...</p>
            ) : (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    1 · Target
                  </h3>
                  <div
                    role="tablist"
                    aria-label="Target kind"
                    className="mb-4 inline-flex rounded-lg border border-border bg-surface-elevated p-1"
                  >
                    {KINDS.map((k) => (
                      <button
                        key={k.key}
                        role="tab"
                        aria-selected={form.target_kind === k.key}
                        onClick={() => setKind(k.key)}
                        className={`rounded-md px-3 py-1.5 text-sm transition ${
                          form.target_kind === k.key
                            ? "bg-surface-card text-text-primary"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {showServicePicker && (
                      <div>
                        <label className={labelCls}>
                          {form.target_kind === "service" ? "Service" : "Owning service"}
                        </label>
                        <Combobox
                          options={services}
                          value={form.service || null}
                          onChange={setService}
                          placeholder="Search services..."
                          label="Owning service"
                          emptyText="No services in inventory"
                        />
                      </div>
                    )}

                    {showEndpointPicker && (
                      <div>
                        <label className={labelCls}>
                          {form.target_kind === "api" ? "API" : "Endpoint"}
                        </label>
                        <Combobox
                          options={endpointsForService}
                          value={form.target_ref || null}
                          onChange={(v) => setForm((f) => ({ ...f, target_ref: v }))}
                          placeholder={form.service ? "Search endpoints..." : "Select a service first"}
                          disabled={!form.service}
                          label={form.target_kind === "api" ? "API" : "Endpoint"}
                          emptyText="No endpoints for this service"
                        />
                      </div>
                    )}

                    {form.target_kind === "infrastructure" && (
                      <div>
                        <label className={labelCls}>Host / component</label>
                        <Combobox
                          options={hosts}
                          value={form.host || null}
                          onChange={(v) => setForm((f) => ({ ...f, host: v }))}
                          placeholder="Search infrastructure..."
                          label="Host or component"
                          emptyText="No infrastructure in inventory"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-3 text-xs">
                    <span className="text-text-muted">Resolved target: </span>
                    {resolvedTarget ? (
                      <span className="font-mono text-text-secondary">{resolvedTarget}</span>
                    ) : (
                      <span className="text-text-muted">incomplete</span>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    2 · Objective
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Name</label>
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Checkout availability"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>SLI type</label>
                      <select
                        value={form.sli_type}
                        onChange={(e) =>
                          setForm({ ...form, sli_type: e.target.value as "availability" | "latency" })
                        }
                        className={inputCls}
                      >
                        <option value="availability">Availability (success rate)</option>
                        <option value="latency">Latency (fast-enough rate)</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Target %</label>
                      <input
                        type="number"
                        step="0.001"
                        value={form.target}
                        onChange={(e) => setForm({ ...form, target: parseFloat(e.target.value) })}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Window (days)</label>
                      <input
                        type="number"
                        value={form.window_days}
                        onChange={(e) =>
                          setForm({ ...form, window_days: parseInt(e.target.value, 10) })
                        }
                        className={inputCls}
                      />
                    </div>
                    {form.sli_type === "latency" && (
                      <div>
                        <label className={labelCls}>Latency threshold (ms)</label>
                        <input
                          type="number"
                          value={form.latency_threshold_ms ?? ""}
                          onChange={(e) =>
                            setForm({ ...form, latency_threshold_ms: parseFloat(e.target.value) })
                          }
                          placeholder="500"
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    3 · Ownership
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Owner</label>
                      <input
                        value={form.owner}
                        onChange={(e) => setForm({ ...form, owner: e.target.value })}
                        placeholder="Platform Team"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Team</label>
                      <input
                        value={form.team}
                        onChange={(e) => setForm({ ...form, team: e.target.value })}
                        placeholder="Payments"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Tags (comma-separated)</label>
                      <input
                        value={form.tags}
                        onChange={(e) => setForm({ ...form, tags: e.target.value })}
                        placeholder="tier1, critical"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Description</label>
                      <input
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="Optional context"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </section>

                <div className="rounded-lg border border-border bg-surface-elevated p-4 text-sm">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Summary
                  </div>
                  {canSubmit ? (
                    <div className="space-y-0.5">
                      <div>
                        {form.target}% {form.sli_type}
                        {form.sli_type === "latency" ? ` under ${form.latency_threshold_ms}ms` : ""} over{" "}
                        {form.window_days} days
                      </div>
                      <div className="font-mono text-text-secondary">{resolvedTarget}</div>
                      {(form.owner || form.team) && (
                        <div className="text-text-muted">
                          {form.owner && `Owner: ${form.owner}`}
                          {form.owner && form.team && " · "}
                          {form.team && `Team: ${form.team}`}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-text-muted">
                      Complete the target, a name, and a valid objective to continue.
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="rounded-lg bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition disabled:opacity-40"
                  >
                    {editingId ? "Save changes" : "Create SLO"}
                  </button>
                  <button
                    onClick={closeForm}
                    className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {slos.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-card py-12 text-center text-sm text-text-muted">
          No SLOs yet. Create one to start tracking a reliability target.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {slos.map((slo) => (
            <SloCard
              key={slo.id}
              slo={slo}
              role={role}
              onEdit={startEdit}
              onClone={clone}
              onEvaluate={evaluate}
              onToggle={toggle}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}
