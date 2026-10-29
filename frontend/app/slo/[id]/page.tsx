"use client";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Shell, { usePoll } from "@/components/Shell";
import { Card } from "@/components/ui";
import { apiGet } from "@/lib/api";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  ReferenceLine,
  ReferenceArea,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type FactorColumn = { key: string; label: string };

type Investigation = {
  slo: {
    id: string;
    name: string;
    sli_type: string;
    target_kind: string;
    service: string | null;
    target_ref: string | null;
    target: number;
    window_days: number;
    window_label: string;
    latency_threshold_ms: number | null;
    rate_threshold_per_min: number | null;
    latency_percentile: number | null;
    bucket_seconds: number | null;
  };
  status: {
    current_sli: number | null;
    budget_remaining_pct: number | null;
    burn_rate: number | null;
    is_meeting: boolean | null;
    total_events: number | null;
    good_events: number | null;
    bad_events: number | null;
    projected_exhaustion_at: string | null;
  };
  history: {
    t: string;
    sli: number | null;
    budget: number | null;
    burn: number | null;
    meeting: boolean | null;
  }[];
  breaches: { start: string; end: string; duration_seconds: number; ongoing: boolean }[];
  factors: { kind: string; columns: FactorColumn[]; rows: Record<string, unknown>[]; note: string };
  correlations: {
    incidents: { id: string; kind: string; severity: string; status: string; summary: string; started_at: string; resolved_at: string | null }[];
    anomalies: { id: string; metric: string; severity: string; status: string; z_score: number; first_seen: string; last_seen: string; promoted_incident_id: string | null }[];
  };
};

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The target IS the SLO's identity: render it the same way the list does.
function targetLine(s: Investigation["slo"]): string {
  if (s.target_kind === "infrastructure") return `infrastructure · ${s.target_ref ?? "unknown"}`;
  if (s.target_kind === "service") return `service · ${s.service ?? s.target_ref ?? "unknown"}`;
  return `${s.target_kind} · ${s.target_ref ?? "unknown"} on ${s.service ?? "unknown"}`;
}

function sliTypeLabel(s: Investigation["slo"]): string {
  switch (s.sli_type) {
    case "latency":
      return `Latency · share under ${s.latency_threshold_ms}ms`;
    case "latency_percentile":
      return `Latency percentile · p${Math.round((s.latency_percentile ?? 0.95) * 100)} under ${s.latency_threshold_ms}ms`;
    case "throughput":
      return `Throughput · floor ${s.rate_threshold_per_min}/min`;
    case "error_rate":
      return "Error rate";
    default:
      return "Availability";
  }
}

export default function SloInvestigationPage() {
  const params = useParams();
  const id = String((params as Record<string, string>)?.id ?? "");
  const [data, setData] = useState<Investigation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    return apiGet<Investigation>(`/api/v1/slos/${id}/investigation`)
      .then((d) => {
        setData(d);
        setErr(null);
        setLoaded(true);
      })
      .catch((e) => {
        setErr(e?.message ?? "Failed to load");
        setLoaded(true);
      });
  }, [id]);

  usePoll(load, [id], 60000);

  const chartData = useMemo(
    () =>
      (data?.history ?? [])
        .filter((h) => h.sli !== null)
        .map((h) => ({ ts: Date.parse(h.t), sli: h.sli as number })),
    [data]
  );

  const activeBreach = data?.breaches.find((b) => b.ongoing) ?? null;

  if (!loaded) {
    return (
      <Shell>
        <div className="p-2 text-sm text-text-muted">Loading investigation...</div>
      </Shell>
    );
  }

  if (err || !data) {
    return (
      <Shell>
        <div className="mx-auto max-w-2xl p-2">
          <Link href="/slo" className="text-sm text-accent hover:underline">
            ← Back to SLOs
          </Link>
          <div className="mt-4 rounded-xl border border-border bg-surface-card p-6 text-sm text-status-critical">
            {err ?? "This SLO could not be loaded."}
          </div>
        </div>
      </Shell>
    );
  }

  const { slo, status, factors } = data;
  const meeting = status.is_meeting;
  const sliColor =
    meeting === false
      ? "text-status-critical"
      : meeting === true
        ? "text-status-healthy"
        : "text-text-primary";
  const budget = status.budget_remaining_pct;
  const budgetBar =
    budget === null
      ? "bg-surface-hover"
      : budget <= 0
        ? "bg-status-critical"
        : budget < 25
          ? "bg-status-warning"
          : "bg-status-healthy";

  return (
    <Shell>
      <div className="mx-auto max-w-5xl">
        {/* header */}
        <Link href="/slo" className="text-sm text-accent hover:underline">
          ← Back to SLOs
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-text-primary">
              {slo.name}
            </h1>
            <div className="mt-1 font-mono text-xs text-text-secondary">{targetLine(slo)}</div>
            <div className="mt-0.5 text-xs text-text-muted">
              {sliTypeLabel(slo)} · {slo.window_label}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              meeting === false
                ? "bg-status-critical/15 text-status-critical"
                : meeting === true
                  ? "bg-status-healthy/15 text-status-healthy"
                  : "bg-surface-hover text-text-muted"
            }`}
          >
            {meeting === false ? "Breaching" : meeting === true ? "Meeting" : "No data"}
          </span>
        </div>

        {/* attainment + budget */}
        <div className="mt-5 grid gap-4 md:grid-cols-[2fr_3fr]">
          <Card>
            <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Current SLI
            </div>
            <div className={`mt-1 flex items-baseline gap-2 ${sliColor}`}>
              <span className="text-4xl font-semibold tabular-nums">
                {status.current_sli === null ? "--" : `${status.current_sli.toFixed(2)}%`}
              </span>
              <span className="text-sm text-text-muted">target {slo.target}%</span>
            </div>
            <div className="mt-4 mb-1 flex items-center justify-between text-xs text-text-muted">
              <span>Error budget remaining</span>
              <span className="tabular-nums">{budget === null ? "--" : `${budget.toFixed(1)}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
              <div
                className={`h-full rounded-full transition-all ${budgetBar}`}
                style={{ width: `${Math.max(0, Math.min(100, budget ?? 0))}%` }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="text-text-muted">
                Burn{" "}
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 tabular-nums ${
                    (status.burn_rate ?? 0) > 1
                      ? "bg-status-critical/15 text-status-critical"
                      : "bg-surface-hover text-text-secondary"
                  }`}
                >
                  {status.burn_rate === null ? "--" : `${status.burn_rate.toFixed(2)}×`}
                </span>
              </span>
              <span className="text-text-muted tabular-nums">
                {(status.total_events ?? 0).toLocaleString()} events
              </span>
              <span className="text-text-muted tabular-nums">
                {(status.bad_events ?? 0).toLocaleString()} bad
              </span>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
                When it is failing
              </div>
              {activeBreach && (
                <span className="text-xs text-status-critical">
                  Breaching {fmtDuration(activeBreach.duration_seconds)} · since{" "}
                  {fmtWhen(activeBreach.start)}
                </span>
              )}
            </div>
            <div className="mt-3 h-[220px] w-full">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  No evaluation history yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                    {data.breaches.map((b, i) => (
                      <ReferenceArea
                        key={i}
                        x1={Date.parse(b.start)}
                        x2={Date.parse(b.end)}
                        fill="var(--color-status-critical)"
                        fillOpacity={0.08}
                        strokeOpacity={0}
                      />
                    ))}
                    <ReferenceLine
                      y={slo.target}
                      stroke="var(--color-text-disabled)"
                      strokeDasharray="4 4"
                      label={{
                        value: `target ${slo.target}%`,
                        position: "insideTopRight",
                        fill: "var(--color-text-muted)",
                        fontSize: 10,
                      }}
                    />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(ts) =>
                        new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                      }
                      stroke="var(--color-border)"
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={["dataMin - 1", 100]}
                      stroke="var(--color-border)"
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                      width={44}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--color-text-primary)",
                      }}
                      labelFormatter={(ts) => fmtWhen(new Date(Number(ts)).toISOString())}
                      formatter={(v: number) => [`${v.toFixed(2)}%`, "SLI"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="sli"
                      stroke="var(--color-data-1)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>

        {/* contributing factors */}
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Where and why
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-card">
            <div className="overflow-x-auto">
              {factors.rows.length === 0 ? (
                <div className="p-6 text-sm text-text-muted">
                  {factors.kind === "infra_none"
                    ? factors.note
                    : "No contributing factors found in this window."}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {factors.columns.map((c) => (
                        <th
                          key={c.key}
                          className="border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted"
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {factors.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border-subtle last:border-0">
                        {factors.columns.map((c, ci) => (
                          <td
                            key={c.key}
                            className={`px-4 py-2.5 ${
                              ci === 0
                                ? "font-mono text-xs text-text-primary"
                                : "tabular-nums text-text-secondary"
                            }`}
                          >
                            {row[c.key] === null || row[c.key] === undefined
                              ? "--"
                              : String(row[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {factors.rows.length > 0 && (
            <div className="mt-2 text-xs text-text-muted">{factors.note}</div>
          )}
        </div>

        {/* drill-downs */}
        {slo.service && (
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Investigate further
            </h2>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/traces?service=${encodeURIComponent(slo.service)}`}
                className="rounded-lg border border-border bg-surface-card px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              >
                View traces
              </Link>
              <Link
                href={`/logs?service=${encodeURIComponent(slo.service)}`}
                className="rounded-lg border border-border bg-surface-card px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              >
                View logs
              </Link>
              <Link
                href={`/map?focus=${encodeURIComponent(slo.service)}`}
                className="rounded-lg border border-border bg-surface-card px-3 py-1.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              >
                Service map
              </Link>
            </div>
          </div>
        )}
        {(data.correlations.incidents.length > 0 || data.correlations.anomalies.length > 0) && (
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Correlated events
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-card p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">Incidents</div>
                {data.correlations.incidents.length === 0 ? (
                  <div className="text-sm text-text-muted">None in this window.</div>
                ) : (
                  <ul className="space-y-2">
                    {data.correlations.incidents.map((i) => (
                      <li key={i.id} className="text-sm">
                        <Link href={`/incidents/${i.id}`} className="text-accent hover:underline">{i.summary}</Link>
                        <span className="ml-2 text-xs text-text-muted">{i.status} &middot; {fmtWhen(i.started_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-border bg-surface-card p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">Anomalies</div>
                {data.correlations.anomalies.length === 0 ? (
                  <div className="text-sm text-text-muted">None in this window.</div>
                ) : (
                  <ul className="space-y-2">
                    {data.correlations.anomalies.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          <Link href={`/anomalies/${a.id}`} className="text-accent hover:underline">{a.metric}</Link>
                          <span className="ml-1 text-xs text-text-muted">z {a.z_score}</span>
                        </span>
                        <span className="shrink-0 text-xs text-text-muted">{a.status} &middot; {fmtWhen(a.first_seen)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
