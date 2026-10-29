"use client";

import { useCallback, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import Shell, { usePoll } from "@/components/Shell";
import { Card, RangePicker, Stat, colorFor } from "@/components/ui";
import {
  apiGet, type CpuCore, type DiskPoint, type FsRow, type InfraAi,
  type InfraPoint, type InfraSummary, type MemBreakdown, type NetPoint,
} from "@/lib/api";

const axis = { stroke: "var(--color-border)", fontSize: 11, tick: { fill: "var(--color-text-primary)" } };
const tip = { background: "var(--color-surface-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };
const hhmm = (b: string) => b.slice(11, 16);
const MEM_COLORS = ["var(--color-data-1)", "var(--color-data-4)", "var(--color-status-warning)", "var(--color-text-disabled)"];

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
const bpsTick = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`);

export default function InfraPage() {
  const [minutes, setMinutes] = useState(30);
  const [sum, setSum] = useState<InfraSummary | null>(null);
  const [ts, setTs] = useState<InfraPoint[]>([]);
  const [net, setNet] = useState<NetPoint[]>([]);
  const [fs, setFs] = useState<FsRow[]>([]);
  const [cores, setCores] = useState<CpuCore[]>([]);
  const [mem, setMem] = useState<MemBreakdown | null>(null);
  const [disk, setDisk] = useState<DiskPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [ai, setAi] = useState<InfraAi | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      apiGet<InfraSummary>(`/api/v1/infra/summary?minutes=10`),
      apiGet<{ points: InfraPoint[] }>(`/api/v1/infra/timeseries?minutes=${minutes}`),
      apiGet<{ points: NetPoint[] }>(`/api/v1/infra/network?minutes=${minutes}`),
      apiGet<{ filesystems: FsRow[] }>(`/api/v1/infra/filesystems?minutes=10`),
      apiGet<{ cores: CpuCore[] }>(`/api/v1/infra/cpu-cores?minutes=10`),
      apiGet<MemBreakdown>(`/api/v1/infra/memory-breakdown?minutes=10`),
      apiGet<{ points: DiskPoint[] }>(`/api/v1/infra/disk-io?minutes=${minutes}`),
    ])
      .then(([s, t, n, f, c, m, d]) => {
        setSum(s); setTs(t.points); setNet(n.points); setFs(f.filesystems);
        setCores(c.cores); setMem(m); setDisk(d.points); setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes]);

  usePoll(load, [minutes], 15000);

  function runAi() {
    setAiLoading(true); setAi(null);
    apiGet<InfraAi>(`/api/v1/infra/ai-summary?minutes=10`)
      .then(setAi).catch((e: Error) => setErr(e.message)).finally(() => setAiLoading(false));
  }

  const verdictColor = ai
    ? { healthy: "text-status-healthy border-status-healthy/40 bg-status-healthy/10",
        watch: "text-status-warning border-status-warning/40 bg-status-warning/10",
        critical: "text-status-critical border-status-critical/40 bg-status-critical/10" }[ai.verdict]
    : "";

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Infrastructure</h1>
          <p className="text-sm text-text-muted">Live host metrics from node-exporter.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={runAi} disabled={aiLoading}
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50">
            {aiLoading ? "Analyzing..." : "Analyze with AI"}
          </button>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {err && <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">{err}</p>}

      {(ai || aiLoading) && (
        <div className={`mb-6 rounded-xl border p-4 ${verdictColor || "border-border bg-surface-elevated"}`}>
          {aiLoading && <p className="text-sm text-text-muted">Reading host metrics...</p>}
          {ai && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider">{ai.verdict}</span>
                <span className="font-medium">{ai.headline}</span>
              </div>
              {ai.details.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                  {ai.details.map((d, i) => <li key={i}>• {d}</li>)}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-text-muted">Generated locally from the metrics above. A starting hypothesis, not a verdict.</p>
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
                  <stop offset="0%" stopColor="var(--color-data-1)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-data-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis domain={[0, 100]} {...axis} tickLine={false} width={32} />
              <Tooltip contentStyle={tip} labelFormatter={(b) => hhmm(b as string)} />
              <Area type="monotone" dataKey="memory_pct" stroke="var(--color-data-1)" strokeWidth={2} fill="url(#memg)" name="Memory %" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Load average (1m) over time">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={ts}>
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis {...axis} tickLine={false} width={32} />
              <Tooltip contentStyle={tip} labelFormatter={(b) => hhmm(b as string)} />
              <Line type="monotone" dataKey="load1" stroke="var(--color-data-4)" strokeWidth={2} dot={false} name="Load 1m" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Per-core CPU busy %">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cores}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="core" {...axis} tickLine={false} tickFormatter={(c) => `core ${c}`} />
              <YAxis domain={[0, 100]} {...axis} tickLine={false} width={32} unit="%" />
              <Tooltip contentStyle={tip} formatter={(v) => [`${v}%`, "busy"]} labelFormatter={(c) => `Core ${c}`} />
              <Bar dataKey="busy_pct" radius={[4, 4, 0, 0]}>
                {cores.map((c) => <Cell key={c.core} fill={c.busy_pct >= 85 ? "var(--color-status-critical)" : c.busy_pct >= 70 ? "var(--color-status-warning)" : "var(--color-status-healthy)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Memory breakdown">
          <div className="flex items-center">
            <ResponsiveContainer width="60%" height={220}>
              <PieChart>
                <Pie data={mem?.breakdown ?? []} dataKey="gb" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {(mem?.breakdown ?? []).map((_, i) => <Cell key={i} fill={MEM_COLORS[i % MEM_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tip} formatter={(v, n) => [`${v} GB`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2 pl-2 text-sm">
              {(mem?.breakdown ?? []).map((m, i) => (
                <div key={m.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-text-secondary">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: MEM_COLORS[i % MEM_COLORS.length] }} />
                    {m.name}
                  </span>
                  <span className="tabular-nums text-text-secondary">{m.gb} GB</span>
                </div>
              ))}
              {mem && (
                <div className="mt-2 border-t border-border pt-2 text-xs text-text-muted">
                  Swap: {mem.swap_used_gb} / {mem.swap_total_gb} GB
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Network throughput (bytes/sec)">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={net}>
              <defs>
                <linearGradient id="rxg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-status-healthy)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--color-status-healthy)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="txg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-status-warning)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--color-status-warning)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis {...axis} tickLine={false} width={48} tickFormatter={bpsTick} />
              <Tooltip contentStyle={tip} labelFormatter={(b) => hhmm(b as string)} formatter={(v) => fmtBps(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="rx_bps" stroke="var(--color-status-healthy)" strokeWidth={2} fill="url(#rxg)" name="RX" />
              <Area type="monotone" dataKey="tx_bps" stroke="var(--color-status-warning)" strokeWidth={2} fill="url(#txg)" name="TX" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Disk I/O (bytes/sec)">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={disk}>
              <defs>
                <linearGradient id="rdg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-data-3)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--color-data-3)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="wrg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-data-5)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--color-data-5)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis dataKey="bucket" tickFormatter={hhmm} {...axis} tickLine={false} minTickGap={40} />
              <YAxis {...axis} tickLine={false} width={48} tickFormatter={bpsTick} />
              <Tooltip contentStyle={tip} labelFormatter={(b) => hhmm(b as string)} formatter={(v) => fmtBps(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="read_bps" stroke="var(--color-data-3)" strokeWidth={2} fill="url(#rdg)" name="Read" />
              <Area type="monotone" dataKey="write_bps" stroke="var(--color-data-5)" strokeWidth={2} fill="url(#wrg)" name="Write" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Filesystems">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fs} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} {...axis} tickLine={false} unit="%" />
              <YAxis type="category" dataKey="mount" {...axis} tickLine={false} width={110} />
              <Tooltip contentStyle={tip} formatter={(v, _n, p) => [`${v}% of ${(p.payload as FsRow).size_gb}GB`, (p.payload as FsRow).mount]} />
              <Bar dataKey="used_pct" radius={[0, 4, 4, 0]}>
                {fs.map((f) => <Cell key={f.mount} fill={f.used_pct >= 85 ? "var(--color-status-critical)" : f.used_pct >= 70 ? "var(--color-status-warning)" : "var(--color-status-healthy)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Load average">
          <div className="grid h-full grid-cols-3 items-center gap-3">
            {[["1m", sum?.load1], ["5m", sum?.load5], ["15m", sum?.load15]].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-border bg-surface-elevated p-4 text-center">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Load {label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{v ?? "-"}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
