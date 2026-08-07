"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  NodeToolbar,
  Position,
  ReactFlow,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import Shell, { usePoll } from "@/components/Shell";
import { RangePicker, colorFor } from "@/components/ui";
import {
  apiGet,
  type MapEdge,
  type ServiceDetail,
  type ServiceMap,
  type Application,
} from "@/lib/api";

type NodeData = {
  label: string;
  calls: number;
  errorRate: number;
  onOpen: (svc: string) => void;
};

const HEALTH_RING = {
  failing: { ring: "#f87171", glow: "rgba(248,113,113,0.55)", text: "text-red-300" },
  degraded: { ring: "#fbbf24", glow: "rgba(251,191,36,0.4)", text: "text-amber-300" },
  healthy: { ring: "#34d399", glow: "rgba(52,211,153,0.35)", text: "text-emerald-300" },
};

function ServiceNode({ data }: { data: NodeData }) {
  const [hover, setHover] = useState(false);
  const health = (data.health ?? "healthy") as "healthy" | "degraded" | "failing";
  const isRoot = data.isRoot ?? false;
  const dim = data.dim ?? false;
  const isFocus = data.isFocus ?? false;
  const hr = isRoot ? { ring: "#38bdf8", glow: "rgba(56,189,248,0.35)", text: "text-sky-300" } : HEALTH_RING[health];
  const dia = isFocus ? 74 : 60;
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: dia, height: dia, opacity: dim ? 0.28 : 1 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => data.onOpen(data.label)}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-white/40" style={{ left: -2 }} />
      <div
        className="flex cursor-pointer items-center justify-center rounded-full transition"
        style={{
          width: dia,
          height: dia,
          background: "#0f1622",
          border: `${isFocus ? 4 : 3}px solid ${hr.ring}`,
          boxShadow: `0 0 ${isFocus ? 28 : 14}px -4px ${hr.glow}${isFocus ? ", 0 0 0 4px rgba(56,189,248,0.25)" : ""}`,
        }}
      >
        <span className="text-xs font-bold text-white">
          {!isRoot && data.nodeErrorPct > 0 ? `${data.nodeErrorPct}%` : ""}
        </span>
      </div>
      <div className="absolute left-1/2 top-full mt-1.5 w-[170px] -translate-x-1/2 text-center pointer-events-none">
        <div className="truncate text-sm font-bold text-white">{data.label}</div>
        <div className={`text-[12px] font-medium ${isRoot ? "text-sky-300/70" : data.nodeErrorPct > 0 ? hr.text : "text-white/50"}`}>
          {isRoot ? `entry · ${data.calls.toLocaleString()} calls` : `${data.calls.toLocaleString()} calls · p95 ${data.p95_ms}ms`}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-white/40" style={{ right: -2 }} />

      <NodeToolbar isVisible={hover} position={data.flipUp ? Position.Top : Position.Bottom} offset={12}>
        <div className="w-64 rounded-xl border border-white/20 bg-[#0b0f17] p-3 text-left shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-white">{data.label}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isRoot ? "bg-sky-500/15 text-sky-300"
              : health === "failing" ? "bg-red-500/15 text-red-300"
              : health === "degraded" ? "bg-amber-500/15 text-amber-300"
              : "bg-emerald-500/15 text-emerald-300"}`}>
              {isRoot ? "Entry point" : health === "failing" ? "Failing" : health === "degraded" ? "Degraded" : "Healthy"}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-white/40">Calls</span><span className="text-white/70">{data.calls.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Error rate</span><span className={data.nodeErrorPct > 0 ? hr.text : "text-white/70"}>{data.nodeErrorPct}%</span></div>
            <div className="flex justify-between"><span className="text-white/40">Latency</span><span className="text-white/70">{data.p95_ms}ms</span></div>
          </div>
          <div className="mt-2 border-t border-white/10 pt-1.5 text-center text-[11px] text-white/35">click for detail</div>
        </div>
      </NodeToolbar>
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

function layout(nodes: string[], edges: MapEdge[]) {
  const NW = 150, NH = 90;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  nodes.forEach((n) => g.setNode(n, { width: NW, height: NH }));
  edges.forEach((e) => { if (e.source !== e.target) g.setEdge(e.source, e.target); });
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n);
    return { id: n, x: pos.x - NW / 2, y: pos.y - NH / 2 };
  });
}

function DetailPanel({
  detail,
  loading,
  onClose,
}: {
  detail: ServiceDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-0 z-20 h-full w-96 overflow-y-auto border-l border-white/10 bg-[#0d1219] p-5 shadow-2xl">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {detail && (
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: colorFor(detail.service) }}
            />
          )}
          <h2 className="text-lg font-semibold">
            {detail?.service ?? "Loading..."}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/5"
        >
          Close
        </button>
      </div>

      {loading && <p className="text-sm text-white/40">Loading detail...</p>}

      {detail && !loading && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-2 text-center">
            {[
              ["Spans", detail.totals.spans],
              ["Errors", detail.totals.errors],
              ["Err %", `${detail.totals.error_rate ?? 0}%`],
              ["p50", `${detail.totals.p50_ms ?? 0}ms`],
              ["p95", `${detail.totals.p95_ms ?? 0}ms`],
              ["p99", `${detail.totals.p99_ms ?? 0}ms`],
            ].map(([label, val]) => (
              <div
                key={label as string}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  {label}
                </div>
                <div className="text-sm font-semibold tabular-nums">{val}</div>
              </div>
            ))}
          </div>

          <Section title="Top operations">
            {detail.operations.map((o) => (
              <Row
                key={o.operation}
                left={o.operation}
                right={`${o.calls} · p95 ${o.p95_ms}ms`}
                bad={o.errors > 0}
              />
            ))}
          </Section>

          <Section title="Called by (upstream)">
            {detail.upstream.length ? (
              detail.upstream.map((u) => (
                <Row key={u.service} left={u.service} right={`${u.calls} calls`} />
              ))
            ) : (
              <Empty>entry point (no upstream)</Empty>
            )}
          </Section>

          <Section title="Depends on (downstream)">
            {detail.downstream.length ? (
              detail.downstream.map((d) => (
                <Row
                  key={d.service}
                  left={d.service}
                  right={`${d.calls} calls`}
                  bad={d.errors > 0}
                />
              ))
            ) : (
              <Empty>leaf (no downstream)</Empty>
            )}
          </Section>

          <Link
            href={`/traces?service=${encodeURIComponent(detail.service)}`}
            className="mt-4 block rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-center text-sm text-sky-200 hover:bg-sky-500/25"
          >
            View traces for {detail.service}
          </Link>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-xs uppercase tracking-wider text-white/40">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ left, right, bad }: { left: string; right: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2 py-1.5 text-sm">
      <span className={`truncate ${bad ? "text-red-300" : "text-white/80"}`}>
        {left}
      </span>
      <span className="shrink-0 pl-2 tabular-nums text-white/45">{right}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-sm text-white/30">{children}</div>;
}

function ServiceMapInner() {
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const fromIncident = searchParams.get("from");
  const [minutes, setMinutes] = useState(60);
  const [app, setApp] = useState("all");
  const [apps, setApps] = useState<Application[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [empty, setEmpty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openService = useCallback(
    (svc: string) => {
      setDetailLoading(true);
      setDetail(null);
      apiGet<ServiceDetail>(
        `/api/v1/stats/service-detail?service=${encodeURIComponent(svc)}&minutes=${minutes}`
      )
        .then(setDetail)
        .catch((e: Error) => setErr(e.message))
        .finally(() => setDetailLoading(false));
    },
    [minutes]
  );

  const load = useCallback(() => {
    apiGet<Application[]>("/api/v1/applications")
      .then(setApps)
      .catch(() => {});

    const appQ = app !== "all" ? `&app=${encodeURIComponent(app)}` : "";
    return apiGet<ServiceMap>(`/api/v1/stats/service-map?minutes=${minutes}${appQ}`)
      .then((data) => {
        setErr(null);
        if (!data.nodes.length) {
          setEmpty(true);
          setNodes([]);
          setEdges([]);
          return;
        }
        setEmpty(false);

        const calls: Record<string, number> = {};
        const errs: Record<string, number> = {};
        data.edges.forEach((e) => {
          calls[e.target] = (calls[e.target] ?? 0) + e.calls;
          errs[e.target] = (errs[e.target] ?? 0) + e.errors;
          calls[e.source] = calls[e.source] ?? 0;
        });

        const nodeById: Record<string, typeof data.nodes[number]> = {};
        data.nodes.forEach((n) => (nodeById[n.id] = n));

        // Blast radius: walk edges up (callers = victims) and down (callees = causes)
        // from the focused service. Fully derived from real edges, not hardcoded.
        const inBlast = new Set<string>();
        if (focus) {
          inBlast.add(focus);
          const down: Record<string, string[]> = {};
          const up: Record<string, string[]> = {};
          data.edges.forEach((e) => {
            (down[e.source] ??= []).push(e.target);
            (up[e.target] ??= []).push(e.source);
          });
          const walk = (start: string, adj: Record<string, string[]>) => {
            const q = [start];
            while (q.length) {
              const n = q.shift()!;
              (adj[n] ?? []).forEach((m) => { if (!inBlast.has(m)) { inBlast.add(m); q.push(m); } });
            }
          };
          walk(focus, down);
          walk(focus, up);
        }
        const placed = layout(data.nodes.map((n) => n.id), data.edges);
        const ys = placed.map((pl) => pl.y);
        const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
        const rn: Node[] = placed.map((p) => {
          const c = calls[p.id] ?? 0;
          const e = errs[p.id] ?? 0;
          return {
            id: p.id,
            type: "service",
            position: { x: p.x, y: p.y },
            data: {
              flipUp: p.y > midY,
              label: p.id,
              calls: c,
              errorRate: c ? Math.round((e / c) * 1000) / 10 : 0,
              health: nodeById[p.id]?.health ?? "healthy",
              p95_ms: nodeById[p.id]?.p95_ms ?? 0,
              nodeErrorPct: nodeById[p.id]?.error_pct ?? 0,
              isRoot: (nodeById[p.id]?.calls ?? 0) === 0 || !data.edges.some((ed) => ed.target === p.id),
              isFocus: focus === p.id,
              dim: focus ? !inBlast.has(p.id) : false,
              onOpen: openService,
            },
          };
        });

        const maxCalls = Math.max(...data.edges.map((e) => e.calls), 1);
        const re: Edge[] = data.edges.map((e, i) => {
          const ep = e.error_pct ?? 0;
          const failing = ep >= 5;
          const degraded = ep >= 1 && ep < 5;
          const stroke = failing ? "#f87171" : degraded ? "#fbbf24" : "#38bdf8";
          const edgeDim = focus ? !(inBlast.has(e.source) && inBlast.has(e.target)) : false;
          return {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            animated: failing,
            label: ep > 0 ? `${e.calls} · ${ep}% err · p95 ${e.p95_ms}ms` : `${e.calls} · p95 ${e.p95_ms}ms`,
            labelStyle: { fill: "#ffffff70", fontSize: 10 },
            labelBgStyle: { fill: "#0b0f17", fillOpacity: 0.85 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
            type: "default",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: stroke,
              width: 20,
              height: 20,
            },
            style: {
              stroke,
              strokeWidth: 1.5 + (e.calls / maxCalls) * 4,
              opacity: edgeDim ? 0.12 : failing ? 0.85 : 0.55,
            },
          };
        });

        setNodes(rn);
        setEdges(re);
      })
      .catch((e: Error) => setErr(e.message));
  }, [minutes, app, openService]);

  usePoll(load, [minutes, app], 15000);

  const flow = useMemo(
    () => (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={focus ? { nodes: [{ id: focus }], duration: 600, padding: 0.4, maxZoom: 1.3 } : { padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#ffffff10" gap={22} />
        <Controls className="!bg-black/70 !border-white/20 [&_button]:!bg-black/60 [&_button]:!border-white/15 [&_button:hover]:!bg-white/10 [&_button]:!fill-white/80" />
      </ReactFlow>
    ),
    [nodes, edges]
  );

  return (
    <Shell>
      {focus && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-400/25 bg-rose-500/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <span className="text-sm text-white/85">
              Blast radius for <span className="font-semibold text-rose-200">{focus}</span>
              <span className="text-white/40"> · incident context</span>
            </span>
          </div>
          {fromIncident && (
            <a href={`/incidents/${fromIncident}`}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/[0.06]">
              <span>←</span> Back to incident
            </a>
          )}
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service map</h1>
          <p className="text-sm text-white/40">
            Dependencies inferred from traces. Click a node to drill in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={app}
            onChange={(e) => setApp(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm outline-none focus:border-white/40"
          >
            <option value="all">All applications</option>
            {apps.map((a) => (
              <option key={a.id} value={a.namespace}>
                {a.name}
              </option>
            ))}
          </select>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {err}
        </p>
      )}

      <div
        className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
        style={{ height: "calc(100vh - 150px)" }}
      >
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-white/30">
            No service-to-service calls in this window
          </div>
        ) : (
          flow
        )}
        {(detail || detailLoading) && (
          <DetailPanel
            detail={detail}
            loading={detailLoading}
            onClose={() => {
              setDetail(null);
              setDetailLoading(false);
            }}
          />
        )}
      </div>
    </Shell>
  );
}

export default function ServiceMapPage() {
  return (
    <Suspense fallback={<Shell><p className="text-sm text-white/40">Loading map…</p></Shell>}>
      <ServiceMapInner />
    </Suspense>
  );
}
