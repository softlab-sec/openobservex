"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import Combobox from "@/components/Combobox";
import { useRole, canOperate, canManage } from "@/lib/role";
import {
  apiGet,
  apiSend,
  type Slo,
  type SloInput,
  type SloInventory,
} from "@/lib/api";
import {
  PERIODS,
  metricByKey,
  metricBySliType,
  metricsForType,
  metricsForCategory,
  CATEGORIES,
  unitByKey,
  periodKeyForDays,
  resolveWindow,
  fmtDate,
  round2,
  type EngineSliType,
  type MetricDef,
  type TargetKind,
} from "@/lib/slo-config";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
const fixedCls =
  "flex items-center rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70";
const labelCls = "mb-1 block text-xs font-medium text-white/50";
const req = <span className="text-red-400">*</span>;

const KINDS: { key: TargetKind; label: string }[] = [
  { key: "service", label: "Service" },
  { key: "api", label: "API" },
  { key: "endpoint", label: "Endpoint" },
  { key: "infrastructure", label: "Infrastructure" },
];


function budgetColor(pct: number | null): string {
  if (pct === null) return "bg-white/20";
  if (pct <= 0) return "bg-red-500";
  if (pct < 25) return "bg-amber-500";
  return "bg-emerald-500";
}

function targetLine(slo: Slo): string {
  const kind = slo.target_kind;
  if (kind === "infrastructure") return `infrastructure · ${slo.target_ref ?? "unknown"}`;
  if (kind === "service") return `service · ${slo.service ?? slo.target_ref ?? "unknown"}`;
  return `${kind} · ${slo.target_ref ?? "unknown"} on ${slo.service ?? "unknown"}`;
}

function sliLabel(slo: Slo): string {
  if (slo.sli_type === "latency") return `Latency · under ${slo.latency_threshold_ms}ms`;
  if (slo.sli_type === "error_rate") return "Error rate";
  if (slo.sli_type === "throughput") return `Throughput \u00b7 \u2265 ${slo.rate_threshold_per_min} req/min`;
  if (slo.sli_type === "latency_percentile") return `Latency p${Math.round((slo.latency_percentile ?? 0.95) * 100)} \u00b7 under ${slo.latency_threshold_ms}ms`;
  return "Availability";
}

function ValidationMessage({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-300/80">{msg}</p>;
}

// Shared, data-driven condition row. Both SLO types render through this; the
// metric's registry config decides source visibility, metric options, unit
// options, and whether a duration threshold applies. The operator is fixed per
// metric for now (editable operators are a later phase).
function ConditionRow({
  metric,
  metricOptions,
  onMetric,
  thresholdValue,
  onThreshold,
  unitKey,
  onUnit,
  bucketSeconds,
  onBucket,
  percentile,
  onPercentile,
  availabilityValue,
  onAvailabilityValue,
  thresholdErr,
  availabilityErr,
  onTouchThreshold,
  onTouchAvailability,
}: {
  metric: MetricDef;
  metricOptions: MetricDef[];
  onMetric: (key: string) => void;
  thresholdValue: number | null;
  onThreshold: (v: number | null) => void;
  unitKey: string;
  onUnit: (k: string) => void;
  bucketSeconds: number;
  onBucket: (n: number) => void;
  percentile: number;
  onPercentile: (n: number) => void;
  availabilityValue: number;
  onAvailabilityValue: (v: number) => void;
  thresholdErr?: string;
  availabilityErr?: string;
  onTouchThreshold: () => void;
  onTouchAvailability: () => void;
}) {
  const isThreshold = metric.hasThreshold;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      {metric.source && (
        <div className="mb-3 flex items-center gap-2 text-xs text-white/40">
          <span>Source:</span>
          <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-white/70">
            {metric.source}
          </span>
        </div>
      )}

      <div className="mb-4">
        <label className={labelCls}>Metric {req}</label>
        <div className="flex flex-wrap gap-1.5">
          {metricsForCategory(metric.category).map((m) => {
            const active = metric.key === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onMetric(m.key)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-white/25 bg-white/15 text-white"
                    : "border-white/10 text-white/50 hover:bg-white/5 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">


        <div>
          <label className={labelCls}>Value {req}</label>
          {isThreshold ? (
            <>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={thresholdValue ?? ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onThreshold(Number.isFinite(v) ? v : null);
                }}
                onBlur={onTouchThreshold}
                placeholder="500"
                className={inputCls}
              />
              {metric.units.length > 1 ? (
                <select
                  value={unitKey}
                  onChange={(e) => onUnit(e.target.value)}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm outline-none focus:border-white/40"
                >
                  {metric.units.map((u) => (
                    <option key={u.key} value={u.key}>{u.label}</option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white/50">
                  {metric.units[0].label}
                </div>
              )}
            </div>
            {metric.bucketWindows && (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-white/40">Evaluation window</label>
                <select
                  value={bucketSeconds}
                  onChange={(e) => onBucket(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm outline-none focus:border-white/40"
                >
                  {metric.bucketWindows.map((w) => (
                    <option key={w.key} value={w.key}>{w.label}</option>
                  ))}
                </select>
              </div>
            )}
            {metric.percentiles && (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-white/40">Percentile</label>
                <select
                  value={percentile}
                  onChange={(e) => onPercentile(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm outline-none focus:border-white/40"
                >
                  {metric.percentiles.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
            )}
            </>
          ) : (
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={Number.isFinite(availabilityValue) ? availabilityValue : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onAvailabilityValue(Number.isFinite(v) ? round2(v) : NaN);
                }}
                onBlur={onTouchAvailability}
                placeholder="99.9"
                className={inputCls}
              />
              <div className="flex items-center rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white/50">
                {metric.units[0].label}
              </div>
            </div>
          )}
        </div>
      </div>

      <ValidationMessage msg={isThreshold ? thresholdErr : availabilityErr} />
      <p className="mt-3 text-xs text-white/30">{metric.description}</p>
    </div>
  );
}

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
    "flex w-full items-center px-3 py-2 text-left text-xs text-white/70 transition hover:bg-white/5";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-white/50 transition hover:bg-white/5 hover:text-white/80"
      >
        <span className="text-lg leading-none">⋮</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#0e1526] py-1 shadow-xl shadow-black/40"
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
              <div className="my-1 border-t border-white/10" />
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onToggle(slo); }}>
                {slo.enabled ? "Disable" : "Enable"}
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                role="menuitem"
                className="flex w-full items-center px-3 py-2 text-left text-xs text-red-300/80 transition hover:bg-red-500/10"
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
          ? "border-white/10 bg-white/[0.02]"
          : "border-white/5 bg-white/[0.01] opacity-60"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{slo.name}</span>
            {!slo.enabled && (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                Disabled
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-sky-300/80">{targetLine(slo)}</div>
          <div className="mt-0.5 text-xs text-white/40">
            {sliLabel(slo)} · {slo.window_days}d window
          </div>
          {slo.budget?.breach_active && slo.budget.breach_seconds != null && (
            <div className="mt-0.5 text-xs text-rose-300/80">
              Breached for {slo.budget.breach_at_least ? "\u2265" : "~"}
              {humanizeDuration(slo.budget.breach_seconds)}
            </div>
          )}
          {slo.budget?.projected_exhaustion_at && (
            <div className="mt-0.5 text-xs text-amber-300/80">
              Budget exhausts in ~{untilFrom(slo.budget.projected_exhaustion_at)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              meeting === null
                ? "bg-white/10 text-white/50"
                : meeting
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-red-500/15 text-red-300"
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
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
          {slo.owner && <span>Owner: {slo.owner}</span>}
          {slo.team && <span>Team: {slo.team}</span>}
          {tags.map((t) => (
            <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-white/50">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-baseline gap-3">
        <span
          className={`text-3xl font-semibold tabular-nums ${
            meeting === null ? "text-white/40" : meeting ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {sli === null ? "--" : `${sli.toFixed(2)}%`}
        </span>
        <span className="text-sm text-white/40">target {slo.target.toFixed(2)}%</span>
      </div>

      <div className="mb-1 flex items-center justify-between text-xs text-white/40">
        <span>Error budget remaining</span>
        <span className="tabular-nums">{budget === null ? "--" : `${budget.toFixed(2)}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${budgetColor(budget)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs">
        {slo.burn_rate !== null && (
          <span
            className={`rounded px-2 py-0.5 tabular-nums ${
              slo.burn_rate > 1 ? "bg-red-500/10 text-red-300" : "bg-white/5 text-white/50"
            }`}
            title="Burn rate: how fast the budget is being consumed (1.0 = sustainable)"
          >
            {slo.burn_rate.toFixed(1)}x burn
          </span>
        )}
        {slo.total_events !== null && (
          <span className="text-white/30">{slo.total_events.toLocaleString()} requests</span>
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
  description: string;
  metricKey: string;
  thresholdValue: number | null;
  unitKey: string;
  bucketSeconds: number;
  percentile: number;
  targetPct: number;
  periodDays: number;
  rangeMode: "rolling" | "custom";
  customStart: string;
  customEnd: string;
  owner: string;
  team: string;
  tags: string;
};

// Humanize a breach duration in seconds -> compact "3h" / "5d" / "12m".
function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = seconds / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// Days until a future ISO timestamp, compact -> "6d" / "18h" / "soon".
function untilFrom(iso: string): string {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (secs <= 0) return "now";
  if (secs < 3600) return "soon";
  return humanizeDuration(secs);
}

// ISO timestamp -> value for a <input type="datetime-local"> (local, no seconds/zone)
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const EMPTY_FORM: FormState = {
  target_kind: "service",
  service: "",
  target_ref: "",
  host: "",
  name: "",
  description: "",
  metricKey: "availability",
  thresholdValue: null,
  unitKey: "pct",
  bucketSeconds: 60,
  percentile: 0.95,
  targetPct: 99.9,
  periodDays: 30,
  rangeMode: "rolling",
  customStart: "",
  customEnd: "",
  owner: "",
  team: "",
  tags: "",
};

export default function SloPage() {
  const ctxRole = useRole();
  const [meRole, setMeRole] = useState<string | undefined>(undefined);
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);

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
    setTouched({});
    setAttempted(false);
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
  function markTouched(field: string) {
    setTouched((t) => ({ ...t, [field]: true }));
  }
  function startEdit(slo: Slo) {
    const kind = (slo.target_kind ?? "service") as TargetKind;
    const metric = metricBySliType(slo.sli_type);
    setForm({
      target_kind: kind,
      service: slo.service ?? "",
      target_ref: kind === "service" ? "" : (slo.target_ref ?? ""),
      host: kind === "infrastructure" ? (slo.target_ref ?? "") : "",
      name: slo.name,
      description: slo.description ?? "",
      metricKey: metric.key,
      thresholdValue: metric.hasThreshold ? ((metric.sliType === "throughput" ? slo.rate_threshold_per_min : slo.latency_threshold_ms) ?? metric.defaultThreshold) : null,
      unitKey: (metric.sliType === "throughput" && slo.throughput_rate_unit) ? slo.throughput_rate_unit : metric.defaultUnit,
      bucketSeconds: slo.bucket_seconds ?? 60,
      percentile: slo.latency_percentile ?? 0.95,
      targetPct: slo.target,
      periodDays: slo.window_days,
      rangeMode: slo.window_start && slo.window_end ? "custom" : "rolling",
      customStart: slo.window_start ? toLocalInput(slo.window_start) : "",
      customEnd: slo.window_end ? toLocalInput(slo.window_end) : "",
      owner: slo.owner ?? "",
      team: slo.team ?? "",
      tags: slo.tags ?? "",
    });
    setTouched({});
    setAttempted(false);
    setEditingId(slo.id);
    setShowForm(true);
  }

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

  const metric = metricByKey(form.metricKey);
  const isLatency = metric.sliType === "latency";
  const isErrorRate = metric.sliType === "error_rate";
  const isThroughput = metric.sliType === "throughput";
  const isPercentile = metric.sliType === "latency_percentile";
  const unit = unitByKey(metric, form.unitKey);
  const bucketWin = metric.bucketWindows?.find((w) => w.key === form.bucketSeconds);
  const bucketNoun = bucketWin?.noun ?? "minutes";
  const pctlLabel = metric.percentiles?.find((p) => p.key === form.percentile)?.label ?? "p95";

  // Target kinds are constrained by what the selected metric can measure.
  const availableKinds = useMemo(
    () => KINDS.filter((k) => metric.targetKinds.includes(k.key)),
    [metric]
  );

  function setKind(kind: TargetKind) {
    setForm((f) => ({ ...f, target_kind: kind, service: "", target_ref: "", host: "" }));
  }
  function setService(svc: string) {
    setForm((f) => ({ ...f, service: svc, target_ref: "" }));
  }
  function setCategory(cat: string) {
    // Selecting a category selects that category's first metric, which drives
    // the existing per-metric form via setMetric.
    const first = metricsForCategory(cat)[0];
    if (first) setMetric(first.key);
  }
  function setMetric(key: string) {
    const m = metricByKey(key);
    setForm((f) => {
      const kindOk = m.targetKinds.includes(f.target_kind);
      const kindReset = kindOk
        ? {}
        : { target_kind: m.targetKinds[0], service: "", target_ref: "", host: "" };
      return {
        ...f,
        metricKey: m.key,
        unitKey: m.defaultUnit,
        bucketSeconds: 60,
        percentile: 0.95,
        thresholdValue: m.hasThreshold ? (f.thresholdValue ?? m.defaultThreshold) : null,
        ...kindReset,
      };
    });
  }

  const resolvedTarget = useMemo(() => {
    const k = form.target_kind;
    if (k === "service") return form.service ? `Service: ${form.service}` : null;
    if (k === "infrastructure") return form.host ? `Infrastructure: ${form.host}` : null;
    if (form.service && form.target_ref)
      return `${k === "api" ? "API" : "Endpoint"}: ${form.target_ref} on ${form.service}`;
    return null;
  }, [form.target_kind, form.service, form.target_ref, form.host]);

  const window = useMemo(() => resolveWindow(form.periodDays), [form.periodDays]);
  // datetime-local bounds from the retention floor the backend reported
  const invMin = inventory?.retention ? toLocalInput(inventory.retention.earliest) : undefined;
  const invMax = inventory?.retention ? toLocalInput(inventory.retention.latest) : undefined;
  // client-side custom-range sanity (backend re-validates authoritatively)
  const customRangeErr = useMemo(() => {
    if (form.rangeMode !== "custom") return null;
    if (!form.customStart || !form.customEnd) return "Pick both a start and an end.";
    if (new Date(form.customStart) >= new Date(form.customEnd)) return "Start must be before end.";
    return null;
  }, [form.rangeMode, form.customStart, form.customEnd]);

  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "SLO name is required";
  if (resolvedTarget === null) errors.target = "Select a target to continue";
  if (isLatency) {
    if (!(Number.isFinite(form.thresholdValue ?? NaN) && (form.thresholdValue ?? 0) > 0))
      errors.threshold = "Enter a threshold greater than 0";
  }
  if (!(Number.isFinite(form.targetPct) && form.targetPct > 0 && form.targetPct <= 100))
    errors.targetPct = "Enter a value greater than 0 and at most 100";
  if (form.rangeMode === "custom") {
    if (!form.customStart || !form.customEnd)
      errors.customRange = "Pick both a start and an end for the custom range";
    else if (new Date(form.customStart) >= new Date(form.customEnd))
      errors.customRange = "Custom range start must be before its end";
  }
  const canSubmit = Object.keys(errors).length === 0;

  function showErr(field: string): string | undefined {
    return (attempted || touched[field]) ? errors[field] : undefined;
  }

  async function submit() {
    setAttempted(true);
    if (!canSubmit) return;
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

      const latency_threshold_ms =
        (isLatency || isPercentile) && metric.hasThreshold && form.thresholdValue != null
          ? Math.round(unit.toMs ? unit.toMs(form.thresholdValue) : form.thresholdValue)
          : null;
      const rate_threshold_per_min =
        metric.sliType === "throughput" && form.thresholdValue != null
          ? (unit.toPerMin ? unit.toPerMin(form.thresholdValue) : form.thresholdValue)
          : null;
      // throughput evaluation bucket window + the unit the floor was entered in,
      // so the SLO round-trips to the same unit on edit. null for other metrics.
      const bucket_seconds =
        metric.sliType === "throughput" || metric.sliType === "latency_percentile"
          ? form.bucketSeconds
          : null;
      const latency_percentile =
        metric.sliType === "latency_percentile" ? form.percentile : null;
      const throughput_rate_unit =
        metric.sliType === "throughput" ? form.unitKey : null;

      const payload: SloInput = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        owner: form.owner.trim() || null,
        team: form.team.trim() || null,
        tags: form.tags.trim() || null,
        sli_type: metric.sliType,
        target_kind: k,
        service,
        target_ref: target_ref || null,
        target: round2(form.targetPct),
        window_days: form.periodDays,
        window_start:
          form.rangeMode === "custom" && form.customStart
            ? new Date(form.customStart).toISOString()
            : null,
        window_end:
          form.rangeMode === "custom" && form.customEnd
            ? new Date(form.customEnd).toISOString()
            : null,
        latency_threshold_ms,
        rate_threshold_per_min,
        latency_percentile,
        bucket_seconds,
        throughput_rate_unit,
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
  const conditionStr = isPercentile
    ? `≥ ${Number.isFinite(form.targetPct) ? form.targetPct : "?"}% of ${bucketNoun} kept ${pctlLabel} ≤ ${form.thresholdValue ?? "?"} ${unit.label}`
    : isThroughput
    ? `≥ ${Number.isFinite(form.targetPct) ? form.targetPct : "?"}% of ${bucketNoun} sustain ≥ ${form.thresholdValue ?? "?"} ${unit.label}`
    : isLatency
    ? `${Number.isFinite(form.targetPct) ? form.targetPct : "?"}% of requests complete within ${form.thresholdValue ?? "?"} ${unit.label}`
    : isErrorRate
    ? `Error rate must stay below ${Number.isFinite(form.targetPct) ? form.targetPct : "?"}%`
    : `Target ${metric.label.toLowerCase()} ≥ ${Number.isFinite(form.targetPct) ? form.targetPct : "?"}%`;

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service Level Objectives</h1>
          <p className="text-sm text-white/40">Track reliability targets and error budgets</p>
        </div>
        {canOperate(role) && (
          <button
            onClick={openCreate}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white/90"
          >
            New SLO
          </button>
        )}
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {err}
        </p>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <div className="my-4 w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0e1526] p-6 shadow-2xl shadow-black/50">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {editingId ? "Edit SLO" : "Create SLO Profile"}
                </h2>
                <p className="text-xs text-white/40">
                  {editingId
                    ? "Editing an existing SLO"
                    : "Define a reliability target on a service, API, endpoint, or host"}
                </p>
              </div>
              <button
                onClick={closeForm}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/60 transition hover:bg-white/5"
              >
                Cancel
              </button>
            </div>

            {invErr ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                Could not load inventory: {invErr}
              </p>
            ) : !inventory ? (
              <p className="py-6 text-center text-sm text-white/30">Loading inventory...</p>
            ) : (
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="flex flex-col gap-3 sm:w-44 sm:shrink-0">
                  <div className="flex gap-2 sm:flex-col">
                    {CATEGORIES.map((cat) => {
                      const active = metric.category === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setCategory(cat.key)}
                          className={`flex flex-1 flex-col rounded-lg border px-3 py-2 text-left text-sm transition sm:flex-none ${
                            active
                              ? "border-white/15 bg-white/10 text-white"
                              : "border-transparent text-white/50 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <span>{cat.label}</span>
                          <span className="text-[10px] text-white/40">{cat.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-6">
                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                      1 · Basic information
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className={labelCls}>SLO name {req}</label>
                        <input
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          onBlur={() => markTouched("name")}
                          placeholder="Checkout availability"
                          className={inputCls}
                        />
                        <ValidationMessage msg={showErr("name")} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelCls}>SLO description</label>
                        <input
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="Optional context"
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                      2 · Target {req}
                    </h3>
                    <div
                      role="tablist"
                      aria-label="Target kind"
                      className="mb-4 inline-flex rounded-lg border border-white/10 bg-black/30 p-1"
                    >
                      {availableKinds.map((k) => (
                        <button
                          key={k.key}
                          role="tab"
                          aria-selected={form.target_kind === k.key}
                          onClick={() => setKind(k.key)}
                          className={`rounded-md px-3 py-1.5 text-sm transition ${
                            form.target_kind === k.key
                              ? "bg-white text-black"
                              : "text-white/60 hover:text-white"
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
                            {form.target_kind === "service" ? "Business service" : "Owning service"} {req}
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
                            {form.target_kind === "api" ? "API" : "Endpoint"} {req}
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
                          <label className={labelCls}>Host / component {req}</label>
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

                    <div className="mt-3">
                      {resolvedTarget ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                          <span>✓</span>
                          <span className="font-mono">{resolvedTarget}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-white/30">Select a target to continue</span>
                      )}
                      <ValidationMessage msg={showErr("target")} />
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                      3 · SLO condition {req}
                    </h3>
                    <ConditionRow
                      metric={metric}
                      metricOptions={metricsForType(metric.sliType)}
                      onMetric={setMetric}
                      thresholdValue={form.thresholdValue}
                      onThreshold={(v) => setForm({ ...form, thresholdValue: v })}
                      unitKey={form.unitKey}
                      onUnit={(k) => setForm({ ...form, unitKey: k })}
                      bucketSeconds={form.bucketSeconds}
                      onBucket={(n) => setForm({ ...form, bucketSeconds: n })}
                      percentile={form.percentile}
                      onPercentile={(n) => setForm({ ...form, percentile: n })}
                      availabilityValue={form.targetPct}
                      onAvailabilityValue={(v) => setForm({ ...form, targetPct: v })}
                      thresholdErr={showErr("threshold")}
                      availabilityErr={showErr("targetPct")}
                      onTouchThreshold={() => markTouched("threshold")}
                      onTouchAvailability={() => markTouched("targetPct")}
                    />

                    {(isLatency || isThroughput) && (
                      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-4">
                        <label className={labelCls}>Objective {req}</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-white/50">At least</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={Number.isFinite(form.targetPct) ? form.targetPct : ""}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setForm({ ...form, targetPct: Number.isFinite(v) ? round2(v) : NaN });
                            }}
                            onBlur={() => markTouched("targetPct")}
                            className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40"
                          />
                          <span className="text-sm text-white/50">
                            {isThroughput
                              ? isPercentile
                                ? `% of ${bucketNoun} kept ${pctlLabel} \u2264 ${form.thresholdValue ?? "?"} ${unit.label} over the period`
                                : `% of ${bucketNoun} must sustain \u2265 ${form.thresholdValue ?? "?"} ${unit.label} over the period`
                              : `% of requests must complete within ${form.thresholdValue ?? "?"} ${unit.label} over the period`}
                          </span>
                        </div>
                        <ValidationMessage msg={showErr("targetPct")} />
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                      4 · Evaluation period {req}
                    </h3>
                    <div className="mb-3 flex gap-2">
                      {(["rolling", "custom"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setForm({ ...form, rangeMode: m })}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                            form.rangeMode === m
                              ? "border-white/15 bg-white/10 text-white"
                              : "border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {m === "rolling" ? "Rolling window" : "Custom range"}
                        </button>
                      ))}
                    </div>
                    {form.rangeMode === "rolling" ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {PERIODS.map((p) => {
                          const active = form.periodDays === p.days;
                          return (
                            <button
                              key={p.key}
                              onClick={() => setForm({ ...form, periodDays: p.days })}
                              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                                active
                                  ? "border-white/15 bg-white/10 text-white"
                                  : "border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className={labelCls}>From</label>
                            <input
                              type="datetime-local"
                              value={form.customStart}
                              min={invMin}
                              max={invMax}
                              onChange={(e) => setForm({ ...form, customStart: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>To</label>
                            <input
                              type="datetime-local"
                              value={form.customEnd}
                              min={invMin}
                              max={invMax}
                              onChange={(e) => setForm({ ...form, customEnd: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                        </div>
                        {inventory?.retention && (
                          <p className="mt-2 text-xs text-white/30">
                            Telemetry available from {fmtDate(new Date(inventory.retention.earliest))} (kept {inventory.retention.days} days). Ranges outside this window cannot be evaluated.
                          </p>
                        )}
                        {customRangeErr && (
                          <p className="mt-2 text-xs text-rose-300/80">{customRangeErr}</p>
                        )}
                      </div>
                    )}
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                        <span className="text-white/40">
                          Resolved range:{" "}
                          <span className="font-mono text-sky-300/80">
                            {fmtDate(window.start)} → {fmtDate(window.end)}
                          </span>
                        </span>
                        <span className="text-white/40">
                          Duration: <span className="text-white/70">{window.days} days</span>
                        </span>
                      </div>
                      {periodKeyForDays(form.periodDays) === null && (
                        <p className="mt-1 text-xs text-white/30">
                          Existing window of {form.periodDays} days, evaluated as a rolling window ending now.
                        </p>
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
                      5 · Ownership
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
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Tags (comma-separated)</label>
                        <input
                          value={form.tags}
                          onChange={(e) => setForm({ ...form, tags: e.target.value })}
                          placeholder="tier1, critical"
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </section>

                  <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                      6 · Summary
                    </div>
                    <div className="space-y-1">
                      <div className="font-medium">{form.name.trim() || "Untitled SLO"}</div>
                      <div className="font-mono text-sky-300/80">{conditionStr}</div>
                      {isLatency && (
                        <div className="text-white/60">
                          Objective: ≥ {Number.isFinite(form.targetPct) ? form.targetPct : "?"}% of requests
                        </div>
                      )}
                      <div className="text-white/50">{resolvedTarget ?? "Target: incomplete"}</div>
                      <div className="text-white/50">
                        Evaluation period: {fmtDate(window.start)} → {fmtDate(window.end)} · {window.days} days
                      </div>
                      {(form.owner || form.team) && (
                        <div className="text-white/50">
                          {form.owner && `Owner: ${form.owner}`}
                          {form.owner && form.team && " · "}
                          {form.team && `Team: ${form.team}`}
                        </div>
                      )}
                      {form.tags.trim() && <div className="text-white/50">Tags: {form.tags.trim()}</div>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={submit}
                      disabled={!canSubmit}
                      className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition disabled:opacity-40"
                    >
                      {editingId ? "Save changes" : "Create SLO"}
                    </button>
                    <button
                      onClick={closeForm}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    {!canSubmit && attempted && (
                      <span className="text-xs text-red-300/70">Resolve the highlighted fields to continue</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {slos.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center text-sm text-white/30">
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
