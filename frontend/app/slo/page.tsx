"use client";
import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { useRole, canOperate, canManage } from "@/lib/role";
import { apiGet, apiSend, type Slo, type SloInput } from "@/lib/api";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
const labelCls = "mb-1 block text-xs font-medium text-white/50";

function budgetColor(pct: number | null): string {
  if (pct === null) return "bg-white/20";
  if (pct <= 0) return "bg-red-500";
  if (pct < 25) return "bg-amber-500";
  return "bg-emerald-500";
}

function SloCard({
  slo,
  role,
  onEvaluate,
  onDelete,
}: {
  slo: Slo;
  role: string | null;
  onEvaluate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const meeting = slo.is_meeting;
  const sli = slo.current_sli;
  const budget = slo.budget_remaining_pct;
  const barWidth = budget === null ? 0 : Math.max(0, Math.min(100, budget));

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{slo.name}</div>
          <div className="mt-0.5 text-xs text-white/40">
            {slo.sli_type === "latency"
              ? `Latency · under ${slo.latency_threshold_ms}ms`
              : "Availability"}
            {slo.service ? ` · ${slo.service}` : " · all services"} · {slo.window_days}d window
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            meeting === null
              ? "bg-white/10 text-white/50"
              : meeting
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-red-500/15 text-red-300"
          }`}
        >
          {meeting === null ? "Not evaluated" : meeting ? "Meeting" : "Breaching"}
        </span>
      </div>

      <div className="mb-4 flex items-baseline gap-3">
        <span
          className={`text-3xl font-semibold tabular-nums ${
            meeting === null ? "text-white/40" : meeting ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {sli === null ? "--" : `${sli.toFixed(3)}%`}
        </span>
        <span className="text-sm text-white/40">target {slo.target}%</span>
      </div>

      <div className="mb-1 flex items-center justify-between text-xs text-white/40">
        <span>Error budget remaining</span>
        <span className="tabular-nums">
          {budget === null ? "--" : `${budget.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${budgetColor(budget)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
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
        <div className="flex items-center gap-2">
          {canOperate(role) && (
            <button
              onClick={() => onEvaluate(slo.id)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/5"
            >
              Refresh
            </button>
          )}
          {canManage(role) && (
            <button
              onClick={() => onDelete(slo.id)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-red-300/70 transition hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SloPage() {
  const role = useRole();
  const [slos, setSlos] = useState<Slo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SloInput>({
    name: "",
    sli_type: "availability",
    service: "",
    target: 99.9,
    window_days: 30,
    latency_threshold_ms: null,
  });

  const load = useCallback(() => {
    return apiGet<Slo[]>("/api/v1/slos")
      .then((d) => {
        setSlos(d);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  usePoll(load, []);

  async function create() {
    setErr(null);
    try {
      const payload: SloInput = {
        ...form,
        service: form.service?.trim() || null,
        latency_threshold_ms:
          form.sli_type === "latency" ? form.latency_threshold_ms : null,
      };
      const created = await apiSend<Slo>("/api/v1/slos", "POST", payload);
      // evaluate immediately so the card isn't blank
      await apiSend<Slo>(`/api/v1/slos/${created.id}/evaluate`, "POST");
      setShowForm(false);
      setForm({ name: "", sli_type: "availability", service: "", target: 99.9, window_days: 30, latency_threshold_ms: null });
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

  async function remove(id: string) {
    try {
      await apiSend(`/api/v1/slos/${id}`, "DELETE");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service Level Objectives</h1>
          <p className="text-sm text-white/40">Track reliability targets and error budgets</p>
        </div>
        {canOperate(role) && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black transition hover:bg-white/90"
          >
            {showForm ? "Cancel" : "New SLO"}
          </button>
        )}
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {err}
        </p>
      )}

      {showForm && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
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
              <label className={labelCls}>Type</label>
              <select
                value={form.sli_type}
                onChange={(e) => setForm({ ...form, sli_type: e.target.value as "availability" | "latency" })}
                className={inputCls}
              >
                <option value="availability">Availability (success rate)</option>
                <option value="latency">Latency (fast-enough rate)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Service (blank = all)</label>
              <input
                value={form.service ?? ""}
                onChange={(e) => setForm({ ...form, service: e.target.value })}
                placeholder="api-gateway"
                className={inputCls}
              />
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
                onChange={(e) => setForm({ ...form, window_days: parseInt(e.target.value, 10) })}
                className={inputCls}
              />
            </div>
            {form.sli_type === "latency" && (
              <div>
                <label className={labelCls}>Latency threshold (ms)</label>
                <input
                  type="number"
                  value={form.latency_threshold_ms ?? ""}
                  onChange={(e) => setForm({ ...form, latency_threshold_ms: parseFloat(e.target.value) })}
                  placeholder="500"
                  className={inputCls}
                />
              </div>
            )}
          </div>
          <button
            onClick={create}
            disabled={!form.name.trim()}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition disabled:opacity-40"
          >
            Create SLO
          </button>
        </div>
      )}

      {slos.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center text-sm text-white/30">
          No SLOs yet. Create one to start tracking a reliability target.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {slos.map((slo) => (
            <SloCard key={slo.id} slo={slo} role={role} onEvaluate={evaluate} onDelete={remove} />
          ))}
        </div>
      )}
    </Shell>
  );
}
