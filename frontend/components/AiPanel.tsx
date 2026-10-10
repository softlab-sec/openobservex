"use client";

import { Card } from "@/components/ui";

export function AiButton({
  onClick,
  loading,
  label = "Analyze with AI",
}: {
  onClick: () => void;
  loading: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/25 disabled:opacity-50"
    >
      {loading ? "Analyzing..." : label}
    </button>
  );
}

const CONF = {
  high: "bg-status-healthy/15 text-status-healthy",
  medium: "bg-status-warning/15 text-status-warning",
  low: "bg-surface-hover text-text-secondary",
};

const VERDICT: Record<string, { chip: string; card: string; label: string }> = {
  healthy: {
    chip: "bg-status-healthy/15 text-status-healthy",
    card: "border-status-healthy/25 bg-status-healthy/[0.06]",
    label: "healthy",
  },
  degraded: {
    chip: "bg-status-warning/15 text-status-warning",
    card: "border-status-warning/25 bg-status-warning/[0.06]",
    label: "degraded",
  },
  failed: {
    chip: "bg-status-critical/15 text-status-critical",
    card: "border-status-critical/25 bg-status-critical/[0.06]",
    label: "failed",
  },
  critical: {
    chip: "bg-status-critical/15 text-status-critical",
    card: "border-status-critical/25 bg-status-critical/[0.06]",
    label: "critical",
  },
};

export function AiResult({
  title,
  headline,
  verdict,
  confidence,
  sections,
  onClose,
}: {
  title: string;
  headline: string;
  verdict?: string;
  confidence?: "low" | "medium" | "high";
  sections: { label: string; items: string[] }[];
  onClose: () => void;
}) {
  const v = verdict ? VERDICT[verdict] : undefined;
  const shown =
    verdict === "healthy"
      ? sections.filter((s) => s.items.filter(Boolean).length > 0)
      : sections;

  return (
    <Card
      className={`mb-4 ${v ? v.card : "border-accent/25 bg-accent/[0.06]"}`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{title}</span>
            {v && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${v.chip}`}>
                {v.label}
              </span>
            )}
            {confidence && verdict !== "healthy" && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${CONF[confidence]}`}>
                {confidence} confidence
              </span>
            )}
          </div>
          <p className="mt-1 max-w-4xl text-sm text-text-secondary">{headline}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
        >
          Close
        </button>
      </div>

      {shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((sec) => (
            <div key={sec.label}>
              <div className="mb-1 text-xs uppercase tracking-wider text-text-muted">
                {sec.label}
              </div>
              <ul className="space-y-1 text-sm text-text-secondary">
                {sec.items.filter(Boolean).length ? (
                  sec.items.filter(Boolean).map((it, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-text-muted">•</span>
                      <span>{it}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-text-muted">none</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-text-muted">
        Generated locally by a language model from the telemetry above. Treat it as
        a starting hypothesis, not a verdict.
      </p>
    </Card>
  );
}
