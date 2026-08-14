"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Shell, { usePoll } from "@/components/Shell";
import { apiGet, type IncidentRow } from "@/lib/api";
import { RangePicker } from "@/components/ui";
import { sevMeta, sevRank, since, duration } from "@/lib/severity";

const KIND_LABEL: Record<string, string> = {
  error_rate: "Error rate",
  latency_p95: "Latency",
  latency_p99: "Latency",
  throughput: "Throughput",
};

type Filter = "active" | "all" | "resolved";

export default function IncidentsPage() {
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [sev, setSev] = useState<"all" | "critical" | "high" | "warning" | "info">("all");
  const [minutes, setMinutes] = useState(60);

  const withinWindow = (i: IncidentRow) => {
    if (i.status === "firing") return true;
    const cutoff = Date.now() - minutes * 60_000;
    const st = new Date(i.started_at).getTime();
    const rs = i.resolved_at ? new Date(i.resolved_at).getTime() : 0;
    return st >= cutoff || rs >= cutoff;
  };

  const load = () =>
    apiGet<IncidentRow[]>("/api/v1/alerts/incidents?limit=200")
      .then((r) => { setItems(r); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  usePoll(load, [], 10000);

  const windowed = items.filter(withinWindow);
  const firing = windowed.filter((i) => i.status === "firing");
  const counts = {
    critical: firing.filter((i) => i.severity === "critical").length,
    high: firing.filter((i) => i.severity === "high").length,
    warning: firing.filter((i) => i.severity === "warning").length,
    info: firing.filter((i) => i.severity === "info").length,
    open: firing.filter((i) => !i.acknowledged_at).length,
    acknowledged: firing.filter((i) => i.acknowledged_at).length,
    resolved: windowed.filter((i) => i.status === "resolved").length,
  };

  const shown = useMemo(() => {
    let list = items.filter(withinWindow);
    if (filter === "active") list = list.filter((i) => i.status === "firing");
    else if (filter === "resolved") list = list.filter((i) => i.status === "resolved");
    if (sev !== "all") list = list.filter((i) => i.severity === sev);
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "firing" ? -1 : 1;
      if (a.severity !== b.severity) return sevRank(a.severity) - sevRank(b.severity);
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, sev, minutes]);

  return (
    <Shell>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
          <p className="text-sm text-white/40">Live problems across your services, most severe first.</p>
        </div>
        <RangePicker value={minutes} onChange={setMinutes} />
      </div>

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">By severity</div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Critical" value={counts.critical} tone="critical" onClick={() => { setFilter("active"); setSev("critical"); }} />
        <SummaryTile label="High" value={counts.high} tone="high" onClick={() => { setFilter("active"); setSev("high"); }} />
        <SummaryTile label="Warning" value={counts.warning} tone="warning" onClick={() => { setFilter("active"); setSev("warning"); }} />
        <SummaryTile label="Info" value={counts.info} tone="info" onClick={() => { setFilter("active"); setSev("info"); }} />
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">By status</div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <SummaryTile label="Open" value={counts.open} tone="neutral" onClick={() => { setFilter("active"); setSev("all"); }} />
        <SummaryTile label="Acknowledged" value={counts.acknowledged} tone="ack" onClick={() => { setFilter("active"); setSev("all"); }} />
        <SummaryTile label="Resolved" value={counts.resolved} tone="resolved" onClick={() => { setFilter("resolved"); setSev("all"); }} />
      </div>

      {err && <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
          {(["active", "all", "resolved"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 capitalize transition ${filter === f ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
          {(["all", "critical", "high", "warning", "info"] as const).map((s) => (
            <button key={s} onClick={() => setSev(s)}
              className={`rounded-md px-3 py-1 capitalize transition ${sev === s ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}>
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-white/40">{shown.length} shown</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        {shown.map((i) => {
          const m = sevMeta(i.severity);
          const resolved = i.status === "resolved";
          return (
            <Link key={i.id} href={`/incidents/${i.id}`}
              className="group flex items-stretch gap-0 border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
              <span className={`w-1 shrink-0 ${resolved ? "bg-white/10" : m.bar}`} />
              <div className="flex flex-1 items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.bg} ${m.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
                    </span>
                    <span className="truncate font-medium text-white/90">{i.rule_name}</span>
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/45">{KIND_LABEL[i.kind] ?? i.kind}</span>
                    {i.service && <span className="truncate text-xs text-white/40">{i.service}</span>}
                  </div>
                  <p className="mt-1 truncate text-sm text-white/55">{i.summary}</p>
                </div>

                <div className="hidden w-28 shrink-0 text-right sm:block">
                  {resolved ? (
                    <span className="text-xs text-emerald-300/80">resolved</span>
                  ) : i.acknowledged_at ? (
                    <span className="text-xs text-amber-300">acknowledged</span>
                  ) : (
                    <span className="text-xs text-rose-300">unacknowledged</span>
                  )}
                  {i.assigned_to && <div className="mt-0.5 truncate text-[11px] text-white/35">{i.assigned_to}</div>}
                </div>

                <div className="w-20 shrink-0 text-right">
                  <div className="text-xs text-white/60">{resolved ? duration(i.started_at, i.resolved_at) : since(i.started_at)}</div>
                  <div className="text-[11px] text-white/30">{resolved ? "duration" : "ago"}</div>
                </div>

                <svg className="h-4 w-4 shrink-0 text-white/20 group-hover:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </div>
            </Link>
          );
        })}
        {shown.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-white/40">
            {filter === "active" ? "No active incidents. All clear." : "No incidents match this filter."}
          </div>
        )}
      </div>
    </Shell>
  );
}

function SummaryTile({ label, value, tone, onClick }: {
  label: string; value: number; tone: "critical" | "high" | "warning" | "info" | "ack" | "resolved" | "neutral"; onClick: () => void;
}) {
  const toneCls =
    tone === "critical" ? "border-rose-500/30 text-rose-300"
    : tone === "high" ? "border-orange-500/30 text-orange-300"
    : tone === "warning" ? "border-amber-400/30 text-amber-300"
    : tone === "info" ? "border-sky-400/30 text-sky-300"
    : tone === "ack" ? "border-violet-400/30 text-violet-300"
    : tone === "resolved" ? "border-emerald-400/30 text-emerald-300"
    : "border-white/15 text-white/70";
  return (
    <button onClick={onClick}
      className={`rounded-xl border bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.05] ${toneCls}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-white/45">{label}</div>
    </button>
  );
}
