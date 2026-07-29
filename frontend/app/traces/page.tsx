"use client";

import { useCallback, useState } from "react";
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

export default function TracesPage() {
  const [minutes, setMinutes] = useState(60);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [selected, setSelected] = useState<TraceDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TraceAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(() => {
    return apiGet<{ items: TraceRow[] }>(
      `/api/v1/traces?minutes=${minutes}&limit=100&errors_only=${errorsOnly}`
    )
      .then((d) => {
        setRows(d.items);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes, errorsOnly]);

  usePoll(load, [minutes, errorsOnly]);

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
          <p className="text-sm text-white/40">Click a trace to see its waterfall</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setErrorsOnly((v) => !v)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              errorsOnly
                ? "border-red-400/40 bg-red-500/15 text-red-300"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            Errors only
          </button>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {err}
        </p>
      )}

      {selected && (
        <Card className="mb-4 border-white/20 bg-white/[0.05]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Trace waterfall</div>
              <div className="font-mono text-xs text-white/40">
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
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/5"
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
            <thead className="text-white/40">
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
                  className={`cursor-pointer border-t border-white/5 transition ${
                    selectedId === r.TraceId
                      ? "bg-sky-500/15 ring-1 ring-inset ring-sky-400/40"
                      : "hover:bg-white/[0.04]"
                  }`}
                >
                  <td className="py-2 font-mono text-xs text-white/50">
                    {new Date(r.Timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2">
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: colorFor(r.ServiceName) }}
                    />
                    {r.ServiceName}
                  </td>
                  <td className="py-2 text-white/80">{r.SpanName}</td>
                  <td className="py-2 tabular-nums text-white/50">{r.span_count}</td>
                  <td className="py-2 tabular-nums">{r.duration_ms} ms</td>
                  <td className="py-2">
                    <Badge status={r.StatusCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-white/30">
              No traces in this window
            </p>
          )}
        </div>
      </Card>
    </Shell>
  );
}
