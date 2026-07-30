"use client";

import { useCallback, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import Shell, { usePoll } from "@/components/Shell";
import { Card, RangePicker, Stat, colorFor } from "@/components/ui";
import {
  apiGet, type FsRow, type InfraAi, type InfraPoint,
  type InfraSummary, type NetPoint,
} from "@/lib/api";

const axis = { stroke: "#ffffff40", fontSize: 11 };
const tip = { background: "#111827", border: "1px solid #ffffff20", borderRadius: 8, fontSize: 12 };
const hhmm = (b: string) => b.slice(11, 16);

function tone(pct: number): "good" | "danger" | "default" {
  if (pct >= 85) return "danger";
  if (pct >= 70) return "default";
  return "good";
}
function fmtBps(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
  return `${v} B/s`;
}

export default function InfraPage() {
  const [minutes, setMinutes] = useState(30);
  const [sum, setSum] = useState<InfraSummary | null>(null);
  const [ts, setTs] = useState<InfraPoint[]>([]);
  const [net, setNet] = useState<NetPoint[]>([]);
  const [fs, setFs] = useState<FsRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [ai, setAi] = useState<InfraAi | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      apiGet<InfraSummary>(`/api/v1/infra/summary?minutes=10`),
      apiGet<{ points: InfraPoint[] }>(`/api/v1/infra/timeseries?minutes=${minutes}`),
      apiGet<{ points: NetPoint[] }>(`/api/v1/infra/network?minutes=${minutes}`),
      apiGet<{ filesystems: FsRow[] }>(`/api/v1/infra/filesystems?minutes=10`),
    ])
      .then(([s, t, n, f]) => {
        setSum(s); setTs(t.points); setNet(n.points); setFs(f.filesystems); setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes]);

  usePoll(load, [minutes], 15000);

  function runAi() {
    setAiLoading(true); setAi(null);
    apiGet<InfraAi>(`/api/v1/infra/ai-summary?minutes=10`)
      .then(setAi)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setAiLoading(false));
  }

  const verdictColor = ai
    ? { healthy: "text-emerald-300 border-emerald-400/40 bg-emerald-500/10",
        watch: "text-amber-300 border-amber-400/40 bg-amber-500/10",
        critical: "text-red-300 border-red-400/40 bg-red-500/10" }[ai.verdict]
    : "";

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Infrastructure</h1>
          <p className="text-sm text-white/40">Live host metrics from node-exporter.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={runAi} disabled={aiLoading}
            className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/25 disabled:opacity-50">
            {aiLoading ? "Analyzing..." : "Analyze with AI"}
          </button>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {err && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}

      {(ai || aiLoading) && (
        <div className={`mb-6 rounded-xl border p-4 ${verdictColor || "border-white/10 bg-white/[0.02]"}`}>
          {aiLoading && <p className="text-sm text-white/50">Reading host metrics...</p>}
          {ai && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider">{ai.verdict}</span>
                <span className="font-medium">{ai.headline}</span>
              </div>
              {ai.details.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-white/70">
                  {ai.details.map((d, i) => <li key={i}>• {d}</li>)}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-white/30">Generated locally from the metrics above. A starting hypothesis, not a verdict.</p>
            </>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="CPU" value={sum?.cpu_pct ?? "-"} suffix="%" tone={sum ? tone(sum.cpu_pct) : "default"} />
        <Stat label="Memory" value={sum?.memory_pct ?? "-"} suffix="%" tone={sum ? tone(sum.memory_pct) : "default"} />
        <Stat label="Disk" value={sum?.disk_pct ?? "-"} suffix="%" tone={sum ? tone(sum.disk_pct) : "default"} />
        <Stat label="Load (1m)" value={sum?.load1 ?? "-"} tone="default" />
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Memory used % over time">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={ts}>
              <defs>
                <linearGradient id="memg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff10" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis domain={[0, 100]} {...axis} tickLine={false} width={32} />
              <Tooltip contentStyle={tip} labelFormatter={hhmm} />
              <Area type="monotone" dataKey="memory_pct" stroke="#38bdf8" strokeWidth={2} fill="url(#memg)" name="Memory %" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Load average (1m) over time">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={ts}>
              <CartesianGrid stroke="#ffffff10" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis {...axis} tickLine={false} width={32} />
              <Tooltip contentStyle={tip} labelFormatter={hhmm} />
              <Line type="monotone" dataKey="load1" stroke="#a78bfa" strokeWidth={2} dot={false} name="Load 1m" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Network throughput (bytes/sec)">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={net}>
              <defs>
                <linearGradient id="rxg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="txg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff10" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis {...axis} tickLine={false} width={48} tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v} />
              <Tooltip contentStyle={tip} labelFormatter={hhmm} formatter={(v: number) => fmtBps(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="rx_bps" stroke="#34d399" strokeWidth={2} fill="url(#rxg)" name="RX" />
              <Area type="monotone" dataKey="tx_bps" stroke="#fbbf24" strokeWidth={2} fill="url(#txg)" name="TX" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Filesystems">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={fs} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid stroke="#ffffff10" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} {...axis} tickLine={false} unit="%" />
              <YAxis type="category" dataKey="mount" {...axis} tickLine={false} width={110} />
              <Tooltip contentStyle={tip} formatter={(v: number, _n, p) => [`${v}% of ${(p.payload as FsRow).size_gb}GB`, (p.payload as FsRow).mount]} />
              <Bar dataKey="used_pct" radius={[0, 4, 4, 0]}>
                {fs.map((f) => <Cell key={f.mount} fill={f.used_pct >= 85 ? "#f87171" : f.used_pct >= 70 ? "#fbbf24" : "#34d399"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Load 1m" value={sum?.load1 ?? "-"} tone="default" />
        <Stat label="Load 5m" value={sum?.load5 ?? "-"} tone="default" />
        <Stat label="Load 15m" value={sum?.load15 ?? "-"} tone="default" />
      </div>
    </Shell>
  );
}
