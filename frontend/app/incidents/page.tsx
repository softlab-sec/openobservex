"use client";

import { useCallback, useMemo, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { Card } from "@/components/ui";
import { apiGet, type IncidentRow } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  latency: "Latency",
  log_spike: "Log spike",
  service_down: "Service down",
};

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function duration(a: string, b: string | null): string {
  const end = b ? new Date(b).getTime() : Date.now();
  const s = (end - new Date(a).getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function IncidentCard({ inc }: { inc: IncidentRow }) {
  const firing = inc.status === "firing";
  return (
    <div className={`rounded-xl border p-4 ${firing ? "border-red-400/40 bg-red-500/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${firing ? "animate-pulse bg-red-400" : "bg-emerald-400"}`} />
            <span className="font-medium text-white/90">{inc.rule_name}</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/50">{KIND_LABEL[inc.kind] ?? inc.kind}</span>
            {inc.service && <span className="text-xs text-white/45">{inc.service}</span>}
          </div>
          <p className="mt-1 text-sm text-white/70">{inc.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`rounded-full px-2 py-0.5 text-xs ${firing ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>{inc.status}</div>
          <div className="mt-1 text-[11px] text-white/35">{firing ? ago(inc.started_at) : `lasted ${duration(inc.started_at, inc.resolved_at)}`}</div>
        </div>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => apiGet<IncidentRow[]>("/api/v1/alerts/incidents?limit=200").then((r) => { setItems(r); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  usePoll(load, [], 10000);
  const firing = useMemo(() => items.filter((i) => i.status === "firing"), [items]);
  const resolved = useMemo(() => items.filter((i) => i.status === "resolved"), [items]);
  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
        <p className="text-sm text-white/40">{firing.length} firing now · {resolved.length} resolved</p>
      </div>
      {err && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}
      {firing.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-wider text-red-300/70">Active now</div>
          <div className="space-y-2">{firing.map((i) => <IncidentCard key={i.id} inc={i} />)}</div>
        </div>
      )}
      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("active")} className={`rounded-lg px-3 py-1.5 text-sm ${tab === "active" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>Active ({firing.length})</button>
        <button onClick={() => setTab("history")} className={`rounded-lg px-3 py-1.5 text-sm ${tab === "history" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>History ({resolved.length})</button>
      </div>
      <div className="space-y-2">
        {(tab === "active" ? firing : resolved).map((i) => <IncidentCard key={i.id} inc={i} />)}
        {(tab === "active" ? firing : resolved).length === 0 && (
          <Card><p className="py-8 text-center text-sm text-white/30">{tab === "active" ? "Nothing firing. All clear." : "No resolved incidents yet."}</p></Card>
        )}
      </div>
    </Shell>
  );
}
