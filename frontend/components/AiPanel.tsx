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
      className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-500/25 disabled:opacity-50"
    >
      {loading ? "Analyzing..." : label}
    </button>
  );
}

const CONF = {
  high: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-white/10 text-white/60",
};

const VERDICT: Record<string, { chip: string; card: string; label: string }> = {
  healthy: {
    chip: "bg-emerald-500/15 text-emerald-300",
    card: "border-emerald-400/25 bg-emerald-500/[0.06]",
    label: "healthy",
  },
  degraded: {
    chip: "bg-amber-500/15 text-amber-300",
    card: "border-amber-400/25 bg-amber-500/[0.06]",
    label: "degraded",
  },
  failed: {
    chip: "bg-red-500/15 text-red-300",
    card: "border-red-400/25 bg-red-500/[0.06]",
    label: "failed",
  },
  critical: {
    chip: "bg-red-500/15 text-red-300",
    card: "border-red-400/25 bg-red-500/[0.06]",
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
      className={`mb-4 ${v ? v.card : "border-violet-400/25 bg-violet-500/[0.06]"}`}
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
          <p className="mt-1 max-w-4xl text-sm text-white/80">{headline}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/5"
        >
          Close
        </button>
      </div>

      {shown.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((sec) => (
            <div key={sec.label}>
              <div className="mb-1 text-xs uppercase tracking-wider text-white/40">
                {sec.label}
              </div>
              <ul className="space-y-1 text-sm text-white/70">
                {sec.items.filter(Boolean).length ? (
                  sec.items.filter(Boolean).map((it, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-white/25">•</span>
                      <span>{it}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-white/30">none</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-white/30">
        Generated locally by a language model from the telemetry above. Treat it as
        a starting hypothesis, not a verdict.
      </p>
    </Card>
  );
}
