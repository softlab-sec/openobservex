"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell, { usePoll } from "@/components/Shell";
import { Badge, Card, RangePicker, colorFor } from "@/components/ui";
import Waterfall from "@/components/Waterfall";
import { AiButton, AiResult } from "@/components/AiPanel";
import {
  apiGet,
  apiPost,
  type TraceAnalysis,
  type TraceDetail,
  type TraceRow,
} from "@/lib/api";

function TracesInner() {
  const searchParams = useSearchParams();
  const [minutes, setMinutes] = useState(60);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [service, setService] = useState<string | null>(null);

  useEffect(() => {
    const svc = searchParams.get("service");
    const mins = searchParams.get("minutes");
    if (svc) setService(svc);
    if (mins) { const n = parseInt(mins, 10); if (!Number.isNaN(n)) setMinutes(n); }
  }, [searchParams]);
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [selected, setSelected] = useState<TraceDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TraceAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(() => {
    return apiGet<{ items: TraceRow[] }>(
      `/api/v1/traces?minutes=${minutes}&limit=100&errors_only=${errorsOnly}${service ? `&service=${encodeURIComponent(service)}` : ""}`
    )
      .then((d) => {
        setRows(d.items);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes, errorsOnly, service]);

  usePoll(load, [minutes, errorsOnly, service]);

  function analyze(id: string) {
    setAiLoading(true);
    setAnalysis(null);
    apiPost<TraceAnalysis>(`/api/v1/ai/analyze-trace/${id}`)
      .then(setAnalysis)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setAiLoading(false));
  }

  function open(id: string) {
    setSelectedId(id);
    setAnalysis(null);
    apiGet<TraceDetail>(`/api/v1/traces/${id}`)
      .then(setSelected)
      .catch((e: Error) => setErr(e.message));
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Traces</h1>
          <p className="text-sm text-text-muted">Click a trace to see its waterfall</p>
        </div>
        <div className="flex items-center gap-3">
          {service && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-status-info/30 bg-status-info/10 px-2.5 py-1 text-xs text-status-info">
              {service}
              <button onClick={() => setService(null)} className="text-status-info/60 hover:text-status-info" aria-label="Clear service filter">✕</button>
            </span>
          )}
          <button
            onClick={() => setErrorsOnly((v) => !v)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              errorsOnly
                ? "border-status-critical/40 bg-status-critical/15 text-status-critical"
                : "border-border text-text-muted hover:text-text-primary"
            }`}
          >
            Errors only
          </button>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {err}
        </p>
      )}

      {selected && (
        <Card className="mb-4 border-border bg-surface-elevated">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Trace waterfall</div>
              <div className="font-mono text-xs text-text-muted">
                {selected.trace_id} · {selected.span_count} spans ·{" "}
                {selected.total_ms.toFixed(2)} ms
              </div>
            </div>
            <div className="flex items-center gap-2">
            <AiButton onClick={() => analyze(selected.trace_id)} loading={aiLoading} />
            <button
              onClick={() => {
                setSelected(null);
                setSelectedId(null);
                setAnalysis(null);
              }}
              className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
            >
              Close
            </button>
            </div>
          </div>
          {analysis && (
            <AiResult
              title="Root cause analysis"
              headline={analysis.probable_cause}
              verdict={analysis.verdict}
              confidence={analysis.confidence}
              onClose={() => setAnalysis(null)}
              sections={[
                { label: "Impact", items: [analysis.impact] },
                { label: "Evidence", items: analysis.evidence },
                { label: "Remediation", items: analysis.remediation },
              ]}
            />
          )}
          <Waterfall detail={selected} />
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Service</th>
                <th className="py-2 font-medium">Operation</th>
                <th className="py-2 font-medium">Spans</th>
                <th className="py-2 font-medium">Duration</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.TraceId}
                  onClick={() => open(r.TraceId)}
                  className={`cursor-pointer border-t border-border transition ${
                    selectedId === r.TraceId
                      ? "bg-status-info/15 ring-1 ring-inset ring-status-info/40"
                      : "hover:bg-surface-elevated"
                  }`}
                >
                  <td className="py-2 font-mono text-xs text-text-muted">
                    {new Date(r.Timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2">
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: colorFor(r.ServiceName) }}
                    />
                    {r.ServiceName}
                  </td>
                  <td className="py-2 text-text-secondary">{r.SpanName}</td>
                  <td className="py-2 tabular-nums text-text-muted">{r.span_count}</td>
                  <td className="py-2 tabular-nums">{r.duration_ms} ms</td>
                  <td className="py-2">
                    <Badge status={r.StatusCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-text-muted">
              No traces in this window
            </p>
          )}
        </div>
      </Card>
    </Shell>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<Shell><p className="text-sm text-text-muted">Loading traces…</p></Shell>}>
      <TracesInner />
    </Suspense>
  );
}
