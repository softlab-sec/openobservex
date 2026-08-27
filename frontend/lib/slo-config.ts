// Data-driven configuration for the SLO builder.
//
// Everything the builder can express lives here, not in the form JSX. Adding a
// metric, operator, unit, or evaluation period later is an edit to this file
// plus the matching engine change; the form does not need to be rebuilt.
//
// Slice 1 exposes only what the current engine computes:
//   - Availability: share of successful requests over the window.
//   - Response duration: share of requests whose duration is under a threshold
//     (a request-count rate, NOT a percentile).
// Deferred capabilities (extra operators, between, percentiles, more metrics,
// multiple conditions, absolute/calendar date ranges) are intentionally absent
// until their engine support exists.

export type EngineSliType = "availability" | "latency" | "error_rate";

export type UnitDef = {
  key: string;
  label: string;
  // For duration units only: convert a value in this unit to milliseconds,
  // which is what the engine stores. Omitted for non-duration units.
  toMs?: (v: number) => number;
};

export type OperatorDef = {
  key: string;
  symbol: string;
  label: string;
};

export type MetricDef = {
  key: string;
  label: string;
  sliType: EngineSliType;
  // Accurate description of what the engine actually measures.
  description: string;
  // Slice 1: exactly one operator per metric, fixed (not yet user-selectable).
  operator: OperatorDef;
  units: UnitDef[];
  defaultUnit: string;
  // A duration metric carries a threshold (the condition value); availability
  // does not, its condition value IS the objective target.
  hasThreshold: boolean;
  defaultThreshold: number | null;
  // Measurement source, shown in the builder only when the metric declares one.
  // Availability has no distinct source in the current engine, so it is null.
  source: string | null;
  // Which target kinds this metric can actually be measured against today.
  targetKinds: TargetKind[];
};

export type TargetKind = "service" | "api" | "endpoint" | "infrastructure";

export const OPERATORS: Record<string, OperatorDef> = {
  gte: { key: "gte", symbol: "≥", label: "at least" },
  lt: { key: "lt", symbol: "<", label: "under" },
  lte: { key: "lte", symbol: "≤", label: "at most" },
};

export const METRICS: MetricDef[] = [
  {
    key: "availability",
    label: "Availability",
    sliType: "availability",
    description: "Percentage of successful requests over the evaluation period.",
    operator: OPERATORS.gte,
    units: [{ key: "pct", label: "%" }],
    defaultUnit: "pct",
    hasThreshold: false,
    defaultThreshold: null,
    source: null,
    targetKinds: ["service", "api", "endpoint", "infrastructure"],
  },
  {
    key: "response_duration",
    label: "Response time",
    sliType: "latency",
    description:
      "Share of requests whose duration is under the threshold. This is a request-count rate, not a percentile.",
    operator: OPERATORS.lt,
    units: [
      { key: "ms", label: "ms", toMs: (v) => v },
      { key: "s", label: "s", toMs: (v) => v * 1000 },
    ],
    defaultUnit: "ms",
    hasThreshold: true,
    defaultThreshold: 500,
    source: "APM traces",
    targetKinds: ["service", "api", "endpoint"],
  },
  {
    key: "error_rate",
    label: "Error rate",
    sliType: "error_rate",
    description: "Percentage of requests that errored over the evaluation period. Lower is better; the objective is a ceiling.",
    operator: OPERATORS.lte,
    units: [{ key: "pct", label: "%" }],
    defaultUnit: "pct",
    hasThreshold: false,
    defaultThreshold: null,
    source: null,
    targetKinds: ["service", "api", "endpoint"],
  },
];

export function metricByKey(key: string): MetricDef {
  return METRICS.find((m) => m.key === key) ?? METRICS[0];
}
export function metricBySliType(t: EngineSliType): MetricDef {
  return METRICS.find((m) => m.sliType === t) ?? METRICS[0];
}
export function unitByKey(metric: MetricDef, key: string): UnitDef {
  return metric.units.find((u) => u.key === key) ?? metric.units[0];
}
export function metricsForType(t: EngineSliType): MetricDef[] {
  return METRICS.filter((m) => m.sliType === t);
}

// ---- Evaluation period ------------------------------------------------------
// Slice 1: fixed rolling windows only. Each resolves to "last N days ending
// now", which is exactly what the engine evaluates, so the shown range is
// always truthful. Calendar-relative and absolute ranges arrive in Phase 1.

export type PeriodDef = {
  key: string;
  label: string;
  days: number;
};

export const PERIODS: PeriodDef[] = [
  { key: "last_1", label: "Last 24 hours", days: 1 },
  { key: "last_7", label: "Last 7 days", days: 7 },
  { key: "last_14", label: "Last 14 days", days: 14 },
  { key: "last_30", label: "Last 30 days", days: 30 },
];

export function periodKeyForDays(days: number): string | null {
  return PERIODS.find((p) => p.days === days)?.key ?? null;
}

// Convention (explicit and used consistently): a window of N days is the range
// [now - N days, now], and its duration is N days.
export function resolveWindow(days: number, now: Date = new Date()): {
  start: Date;
  end: Date;
  days: number;
} {
  const end = now;
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end, days };
}

export function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
