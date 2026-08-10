"use client";
import { useCallback, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { Card, Stat } from "@/components/ui";
import { apiGet, type SystemHealth } from "@/lib/api";

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string; ring: string }> = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300", label: "All systems operational", ring: "ring-emerald-400/30" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "Degraded, a component needs attention", ring: "ring-amber-400/30" },
  down: { dot: "bg-red-400", text: "text-red-300", label: "Core storage unavailable", ring: "ring-red-400/30" },
};

function lagTone(sec: number | null): "good" | "default" | "danger" {
  if (sec === null) return "danger";
  if (sec <= 30) return "good";
  if (sec <= 120) return "default";
  return "danger";
}
function msTone(ms: number | null): "good" | "default" | "danger" {
  if (ms === null) return "danger";
  if (ms <= 50) return "good";
  if (ms <= 250) return "default";
  return "danger";
}
function fmtRows(n: number | null): string {
  if (n === null) return "-";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const COMPONENT_LABEL: Record<string, string> = {
  clickhouse: "ClickHouse",
  postgres: "PostgreSQL",
  ingest_gateway: "Ingest Gateway",
  ollama: "AI Runtime (Ollama)",
};

export default function SystemHealthPage() {
  const [h, setH] = useState<SystemHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<SystemHealth>("/api/v1/system/health")
      .then((d) => { setH(d); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, []);
  usePoll(load, 10000);

  const st = h ? STATUS_STYLE[h.status] ?? STATUS_STYLE.degraded : null;
  const signals: Array<["traces" | "logs" | "metrics", string]> = [
    ["traces", "Traces"], ["logs", "Logs"], ["metrics", "Metrics"],
  ];

  return (
    <Shell title="System Health">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">System Health</h1>
          <p className="text-sm text-white/50">OpenObserveX observing its own operational vitals. Refreshes every 10s.</p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/[0.08]"
        >
          Refresh
        </button>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>
      )}

      {h && st && (
        <div className={`mb-6 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 ring-1 ${st.ring}`}>
          <span className="relative flex h-3 w-3">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${st.dot} opacity-60`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${st.dot}`} />
          </span>
          <div>
            <div className={`text-sm font-semibold uppercase tracking-wide ${st.text}`}>{h.status}</div>
            <div className="text-sm text-white/60">{st.label}</div>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ingest Lag" value={h?.ingest_lag_seconds ?? "-"} suffix="s" tone={h ? lagTone(h.ingest_lag_seconds) : "default"} />
        <Stat label="ClickHouse Query" value={h?.clickhouse_query_ms ?? "-"} suffix="ms" tone={h ? msTone(h.clickhouse_query_ms) : "default"} />
        <Stat label="Postgres Query" value={h?.postgres_query_ms ?? "-"} suffix="ms" tone={h ? msTone(h.postgres_query_ms) : "default"} />
        <Stat label="Signals Live" value={h ? signals.filter(([k]) => (h.storage[k].per_min_5m ?? 0) > 0).length : "-"} suffix="/3" />
      </div>

      <Card title="Storage and Ingest Rate">
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.04] text-left text-white/50">
                <th className="px-4 py-2 font-medium">Signal</th>
                <th className="px-4 py-2 font-medium">Stored Rows</th>
                <th className="px-4 py-2 font-medium">Ingest Rate (last 5m)</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(([key, label]) => {
                const e = h?.storage[key];
                const rate = e?.per_min_5m ?? 0;
                const live = rate > 0;
                return (
                  <tr key={key} className="border-t border-white/5">
                    <td className="px-4 py-2.5 font-medium text-white/80">{label}</td>
                    <td className="px-4 py-2.5 tabular-nums text-white/70">{fmtRows(e?.rows ?? null)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-white/70">{e ? `${rate.toLocaleString()} /min` : "-"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs ${live ? "text-emerald-300" : "text-white/40"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-white/30"}`} />
                        {live ? "flowing" : "idle"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6">
        <Card title="Component Liveness">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {h && Object.entries(h.components).map(([name, up]) => (
              <div key={name} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${up ? "bg-emerald-400" : "bg-red-400"}`} />
                <div>
                  <div className="text-sm text-white/80">{COMPONENT_LABEL[name] ?? name}</div>
                  <div className={`text-xs ${up ? "text-emerald-300/70" : "text-red-300/70"}`}>{up ? "reachable" : "unreachable"}</div>
                </div>
              </div>
            ))}
            {!h && <div className="text-sm text-white/40">Loading...</div>}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
