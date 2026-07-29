"use client";

import { useCallback, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Shell, { usePoll } from "@/components/Shell";
import { Card, RangePicker, Stat, colorFor } from "@/components/ui";
import { apiGet, type ContainerStat, type InfraSummary } from "@/lib/api";

const axis = { stroke: "#ffffff40", fontSize: 11 };
const tip = { background: "#111827", border: "1px solid #ffffff20", borderRadius: 8, fontSize: 12 };

function tone(pct: number): "good" | "danger" | "default" {
  if (pct >= 85) return "danger";
  if (pct >= 70) return "default";
  return "good";
}

export default function InfraPage() {
  const [minutes, setMinutes] = useState(30);
  const [sum, setSum] = useState<InfraSummary | null>(null);
  const [containers, setContainers] = useState<ContainerStat[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    return Promise.all([
      apiGet<InfraSummary>(`/api/v1/infra/summary?minutes=10`),
      apiGet<{ containers: ContainerStat[] }>(`/api/v1/infra/containers?minutes=10`),
    ])
      .then(([s, c]) => { setSum(s); setContainers(c.containers); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  }, [minutes]);

  usePoll(load, [minutes], 15000);

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Infrastructure</h1>
          <p className="text-sm text-white/40">Host and container metrics from node-exporter &amp; cAdvisor.</p>
        </div>
        <RangePicker value={minutes} onChange={setMinutes} />
      </div>

      {err && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="CPU busy" value={sum?.cpu_busy_pct ?? "-"} suffix="%" tone={sum ? tone(sum.cpu_busy_pct) : "default"} />
        <Stat label="Memory used" value={sum?.memory_used_pct ?? "-"} suffix="%" tone={sum ? tone(sum.memory_used_pct) : "default"} />
        <Stat label="Disk used" value={sum?.disk_used_pct ?? "-"} suffix="%" tone={sum ? tone(sum.disk_used_pct) : "default"} />
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title={`Host — ${sum?.memory_total_gb ?? "?"} GB RAM`}>
          <div className="space-y-4 py-2">
            <Meter label="CPU" pct={sum?.cpu_busy_pct ?? 0} />
            <Meter label="Memory" pct={sum?.memory_used_pct ?? 0} />
            <Meter label={`Disk (${sum?.disk_total_gb ?? "?"} GB)`} pct={sum?.disk_used_pct ?? 0} />
          </div>
        </Card>

        <Card title="Container memory (MB)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={containers} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid stroke="#ffffff10" horizontal={false} />
              <XAxis type="number" {...axis} tickLine={false} />
              <YAxis type="category" dataKey="container" {...axis} tickLine={false} width={130} />
              <Tooltip contentStyle={tip} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="mem_mb" radius={[0, 4, 4, 0]}>
                {containers.map((c) => <Cell key={c.container} fill={colorFor(c.container)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {containers.length === 0 && <p className="py-4 text-center text-sm text-white/30">No container metrics yet</p>}
        </Card>
      </div>
    </Shell>
  );
}

function Meter({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 85 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="tabular-nums text-white/90">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded bg-white/10">
        <div className={`h-2 rounded ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
