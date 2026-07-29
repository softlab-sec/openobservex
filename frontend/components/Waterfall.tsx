"use client";

import { useState } from "react";
import { colorFor } from "@/components/ui";
import type { Span, TraceDetail } from "@/lib/api";

/** Nesting depth for each span, resolved from its parent chain. */
function depthMap(spans: Span[]): Record<string, number> {
  const byId: Record<string, Span> = {};
  spans.forEach((s) => (byId[s.SpanId] = s));
  const depth: Record<string, number> = {};
  const resolve = (s: Span, guard = 0): number => {
    if (depth[s.SpanId] !== undefined) return depth[s.SpanId];
    if (!s.ParentSpanId || !byId[s.ParentSpanId] || guard > 32) depth[s.SpanId] = 0;
    else depth[s.SpanId] = resolve(byId[s.ParentSpanId], guard + 1) + 1;
    return depth[s.SpanId];
  };
  spans.forEach((s) => resolve(s));
  return depth;
}

function Ruler({ total }: { total: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="relative mb-2 h-4 border-b border-white/10">
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute -translate-x-1/2 text-[11px] tabular-nums text-white/35"
          style={{ left: `${t * 100}%` }}
        >
          {(total * t).toFixed(0)}ms
        </span>
      ))}
    </div>
  );
}

export default function Waterfall({ detail }: { detail: TraceDetail }) {
  const depths = depthMap(detail.spans);
  const total = detail.total_ms || 1;
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="text-sm">
      <div className="flex gap-4">
        <div className="w-80 shrink-0" />
        <div className="flex-1">
          <Ruler total={total} />
        </div>
        <div className="w-24 shrink-0" />
      </div>

      <div className="max-h-[65vh] space-y-1 overflow-y-auto pr-1">
        {detail.spans.map((s) => {
          const left = (s.offset_ms / total) * 100;
          const width = Math.max((s.duration_ms / total) * 100, 0.6);
          const isError = s.StatusCode === "Error";
          const isOpen = open.has(s.SpanId);
          const attrs = Object.entries(s.SpanAttributes || {});

          return (
            <div
              key={s.SpanId}
              onClick={() => toggle(s.SpanId)}
              className={`cursor-pointer rounded-lg px-2 py-2 transition-colors ${
                isError
                  ? "bg-red-500/[0.07] hover:bg-red-500/[0.12]"
                  : "hover:bg-white/[0.05]"
              } ${isOpen ? "ring-1 ring-inset ring-white/15" : ""}`}
            >
              <div className="flex items-center gap-4">
                <div
                  className="flex w-80 shrink-0 items-center truncate"
                  style={{ paddingLeft: depths[s.SpanId] * 18 }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`mr-1 h-3 w-3 shrink-0 text-white/35 transition-transform duration-200 ${
                      isOpen ? "rotate-90" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: colorFor(s.ServiceName) }}
                  />
                  <span className="truncate font-medium text-white/90">
                    {s.SpanName}
                  </span>
                </div>

                <div className="relative h-7 flex-1 rounded bg-white/[0.05]">
                  <div
                    className={`absolute top-0 flex h-7 items-center rounded px-2 transition-all ${
                      isError ? "bg-red-400/75" : "bg-sky-400/65"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <span className="truncate text-[11px] font-medium text-black/70">
                      {s.duration_ms.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className="w-24 shrink-0 text-right tabular-nums text-white/60">
                  {s.duration_ms.toFixed(2)} ms
                </div>
              </div>

              {/* animated expand: 0fr -> 1fr keeps it smooth without fixed heights */}
              <div
                className={`grid transition-all duration-200 ease-out ${
                  isOpen ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/40"
                    style={{ paddingLeft: depths[s.SpanId] * 18 + 34 }}
                  >
                    <span className="text-white/55">{s.ServiceName}</span>
                    <span>{s.SpanKind}</span>
                    <span className="font-mono text-white/35">
                      span={s.SpanId.slice(0, 12)}
                    </span>
                    {isError && s.StatusMessage && (
                      <span className="text-red-300">{s.StatusMessage}</span>
                    )}
                    {attrs.map(([k, v]) => (
                      <span key={k}>
                        {k}=<span className="text-white/60">{v}</span>
                      </span>
                    ))}
                    {attrs.length === 0 && !s.StatusMessage && (
                      <span className="text-white/25">no attributes</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
