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
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}
    >
      {title && (
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">
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
      ? "text-red-400"
      : tone === "good"
        ? "text-emerald-400"
        : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-wider text-white/40">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {value}
        {suffix && <span className="ml-1 text-sm text-white/40">{suffix}</span>}
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
          ? "bg-red-500/15 text-red-300"
          : "bg-emerald-500/15 text-emerald-300"
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
      ? "bg-red-500/15 text-red-300"
      : l === "WARN" || l === "WARNING"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-sky-500/15 text-sky-300";
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
    <div className="flex rounded-lg border border-white/10 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded px-2.5 py-1 text-xs transition ${
            value === o.v ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SERVICE_COLORS = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
];

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return SERVICE_COLORS[h % SERVICE_COLORS.length];
}
