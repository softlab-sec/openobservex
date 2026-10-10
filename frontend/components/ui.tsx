"use client";

import React from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface-card p-4 card-elev ${className}`}
    >
      {title && (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  suffix,
  tone = "default",
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: "default" | "danger" | "good";
}) {
  const color =
    tone === "danger"
      ? "text-status-critical"
      : tone === "good"
        ? "text-status-healthy"
        : "text-text-primary";
  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 card-elev">
      <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {value}
        {suffix && <span className="ml-1 text-sm font-normal text-text-muted">{suffix}</span>}
      </div>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  const danger = status === "Error";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        danger
          ? "bg-status-critical/15 text-status-critical"
          : "bg-status-healthy/15 text-status-healthy"
      }`}
    >
      {danger ? "Error" : "OK"}
    </span>
  );
}

export function SeverityBadge({ level }: { level: string }) {
  const l = level.toUpperCase();
  const cls =
    l === "ERROR"
      ? "bg-status-critical/15 text-status-critical"
      : l === "WARN" || l === "WARNING"
        ? "bg-status-warning/15 text-status-warning"
        : "bg-status-info/15 text-status-info";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{l}</span>
  );
}

export function RangePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const opts = [
    { label: "15m", v: 15 },
    { label: "1h", v: 60 },
    { label: "6h", v: 360 },
    { label: "24h", v: 1440 },
  ];
  return (
    <div className="flex rounded-lg border border-border bg-surface-card p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            value === o.v
              ? "bg-accent text-accent-fg"
              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SERVICE_COLORS = [
  "var(--color-data-1)",
  "var(--color-data-2)",
  "var(--color-data-3)",
  "var(--color-data-4)",
  "var(--color-data-5)",
  "var(--color-data-6)",
  "var(--color-data-7)",
];

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}
