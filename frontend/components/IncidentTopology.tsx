"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  NodeToolbar,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { apiGet, type ServiceMap } from "@/lib/api";

type NData = {
  label: string;
  health: "healthy" | "degraded" | "failing";
  calls: number;
  errorPct: number;
  p95: number;
  role: "focus" | "upstream" | "downstream" | "other";
  rps: number;
  windowMin: number;
};

const HEALTH = {
  failing: { ring: "#f87171", glow: "rgba(248,113,113,0.55)", text: "text-red-300" },
  degraded: { ring: "#fbbf24", glow: "rgba(251,191,36,0.4)", text: "text-amber-300" },
  healthy: { ring: "#34d399", glow: "rgba(52,211,153,0.35)", text: "text-emerald-300" },
};
const HEALTH_LABEL = { failing: "Failing", degraded: "Degraded", healthy: "Healthy" };

function summarize(d: NData): string {
  if (d.health === "failing")
    return `Failing — ${d.errorPct}% of calls are erroring${d.p95 > 0 ? `, p95 latency ${d.p95}ms` : ""}. Likely source of impact.`;
  if (d.health === "degraded")
    return `Degraded — elevated error rate (${d.errorPct}%)${d.p95 > 0 ? ` and p95 ${d.p95}ms` : ""}. Worth watching.`;
  return `Healthy — normal error rate${d.p95 > 0 ? ` and latency (p95 ${d.p95}ms)` : ""}.`;
}

const NODE_W = 180;
const NODE_H = 110;

function CircleNode({ data }: { data: NData }) {
  const [hover, setHover] = useState(false);
  const h = HEALTH[data.health];
  const isFocus = data.role === "focus";
  const dia = isFocus ? 74 : 60;
  const roleLabel =
    data.role === "focus" ? "Affected service"
    : data.role === "upstream" ? "Upstream (impacted)"
    : data.role === "downstream" ? "Downstream (dependency)"
    : "";
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: dia, height: dia }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-white/40" style={{ left: -2 }} />
      <div
        className="flex items-center justify-center rounded-full transition"
        style={{
          width: dia,
          height: dia,
          background: "#0f1622",
          border: `${isFocus ? 4 : 3}px solid ${h.ring}`,
          boxShadow: `0 0 ${isFocus ? 28 : 15}px -4px ${h.glow}${isFocus ? ", 0 0 0 4px rgba(56,189,248,0.25)" : ""}`,
        }}
      >
        <span className="text-sm font-bold text-white">
          {data.errorPct > 0 ? `${data.errorPct}%` : ""}
        </span>
      </div>
      <div className="absolute left-1/2 top-full mt-1.5 w-[170px] -translate-x-1/2 text-center pointer-events-none">
        <div className="truncate text-[15px] font-bold text-white">{data.label}</div>
        <div className={`text-[13px] font-medium ${data.errorPct > 0 ? h.text : "text-white/55"}`}>
          {data.calls.toLocaleString()} calls · p95 {data.p95}ms
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-white/40" style={{ right: -2 }} />

      <NodeToolbar isVisible={hover} position={data.flipUp ? Position.Top : Position.Bottom} offset={12}>
        <div className="w-72 rounded-xl border border-white/20 bg-[#0b0f17] p-4 text-left shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-base font-bold text-white">{data.label}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              data.health === "failing" ? "bg-red-500/15 text-red-300"
              : data.health === "degraded" ? "bg-amber-500/15 text-amber-300"
              : "bg-emerald-500/15 text-emerald-300"}`}>
              {HEALTH_LABEL[data.health]}
            </span>
          </div>
          {roleLabel && <div className="mb-2 text-[10px] uppercase tracking-wide text-white/35">{roleLabel}</div>}
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-white/40">Error rate</span><span className={data.errorPct > 0 ? h.text : "text-white/70"}>{data.errorPct}%</span></div>
            <div className="flex justify-between"><span className="text-white/40">p95 latency</span><span className="text-white/70">{data.p95}ms</span></div>
            <div className="flex justify-between"><span className="text-white/40">Throughput</span><span className="text-white/70">{data.rps} req/s</span></div>
            <div className="flex justify-between"><span className="text-white/40">Calls ({data.windowMin}m)</span><span className="text-white/70">{data.calls.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-white/40">Active alerts</span><span className="text-white/40">—</span></div>
          </div>
          <div className="mt-3 border-t border-white/10 pt-2.5 text-sm leading-relaxed text-white/70">
            {summarize(data)}
          </div>
        </div>
      </NodeToolbar>
    </div>
  );
}

const nodeTypes = { circle: CircleNode };

function layoutDagre(rn: Node[], re: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 90, marginx: 30, marginy: 30 });
  rn.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  re.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const positioned = rn.map((n) => {
    const p = g.node(n.id);
    return { node: n, y: p.y - NODE_H / 2, x: p.x - NODE_W / 2 };
  });
  const ys = positioned.map((pp) => pp.y);
  const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  return positioned.map((pp) => ({
    ...pp.node,
    position: { x: pp.x, y: pp.y },
    data: { ...(pp.node.data as object), flipUp: pp.y > midY },
  }));
}

function TopologyGraph({ service, minutes }: { service: string; minutes: number }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const load = useCallback(() => {
    apiGet<ServiceMap>(`/api/v1/stats/service-map?minutes=${minutes}`)
      .then((data) => {
        if (!data.nodes.length) return;
        const down: Record<string, string[]> = {};
        const up: Record<string, string[]> = {};
        data.edges.forEach((e) => {
          (down[e.source] ??= []).push(e.target);
          (up[e.target] ??= []).push(e.source);
        });
        const upstream = new Set<string>();
        const downstream = new Set<string>();
        const walk = (start: string, adj: Record<string, string[]>, into: Set<string>) => {
          const q = [start];
          while (q.length) {
            const n = q.shift()!;
            (adj[n] ?? []).forEach((m) => {
              if (m !== service && !into.has(m)) { into.add(m); q.push(m); }
            });
          }
        };
        walk(service, up, upstream);
        walk(service, down, downstream);
        const inBlast = new Set<string>([service, ...upstream, ...downstream]);

        const nodeById: Record<string, (typeof data.nodes)[number]> = {};
        data.nodes.forEach((n) => (nodeById[n.id] = n));
        if (!nodeById[service]) return;

        const rn: Node[] = [...inBlast].map((id) => {
          const nd = nodeById[id];
          const role: NData["role"] =
            id === service ? "focus" : upstream.has(id) ? "upstream" : "downstream";
          return {
            id,
            type: "circle",
            position: { x: 0, y: 0 },
            data: {
              label: id,
              health: nd.health,
              calls: nd.calls,
              errorPct: nd.error_pct,
              p95: nd.p95_ms,
              role,
              rps: Math.round((nd.calls / (minutes * 60)) * 10) / 10,
              windowMin: minutes,
            },
            draggable: true,
          };
        });

        const re: Edge[] = data.edges
          .filter((e) => inBlast.has(e.source) && inBlast.has(e.target))
          .map((e, i) => {
            const ep = e.error_pct ?? 0;
            const failing = ep >= 5;
            const degraded = ep >= 1 && ep < 5;
            const stroke = failing ? "#f87171" : degraded ? "#fbbf24" : "#38bdf8";
            return {
              id: `e${i}`,
              source: e.source,
              target: e.target,
              animated: failing,
              type: "default",
              label: `${e.calls.toLocaleString()} calls${ep > 0 ? ` · ${ep}% err` : ""}`,
              labelStyle: { fill: "#ffffff90", fontSize: 11 },
              labelBgStyle: { fill: "#0b0f17", fillOpacity: 0.9 },
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
              markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 22, height: 22 },
              style: { stroke, strokeWidth: 2.5, opacity: failing ? 0.95 : 0.6 },
            };
          });

        setNodes(layoutDagre(rn, re));
        setEdges(re);
      })
      .catch(() => {});
  }, [service, minutes, setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      minZoom={0.3}
      maxZoom={2}
      panOnDrag
      zoomOnScroll
    >
      <Background color="#ffffff10" gap={22} />
      <Controls className="!bg-black/70 !border-white/20 [&_button]:!bg-black/60 [&_button]:!border-white/15 [&_button:hover]:!bg-white/10 [&_button]:!fill-white/80" showInteractive={false} />
    </ReactFlow>
  );
}

export default function IncidentTopology({
  service,
  minutes = 60,
}: {
  service: string | null;
  minutes?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const graph = useMemo(
    () => (service ? <TopologyGraph service={service} minutes={minutes} /> : null),
    [service, minutes]
  );

  if (!service)
    return (
      <p className="text-sm text-white/40">
        This incident has no single affected service to map.
      </p>
    );

  const legend = (
    <div className="flex items-center gap-4 text-[11px] text-white/45">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />healthy</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />degraded</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />failing</span>
      <span className="text-white/30">· arrows show request flow (caller → dependency)</span>
    </div>
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-[#0b0f17]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-white/90">Service dependency impact — {service}</div>
            {legend}
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/[0.08]"
          >
            ✕ Close
          </button>
        </div>
        <div className="flex-1">{graph}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        {legend}
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/[0.08]"
          title="Expand to fullscreen"
        >
          ⛶ Expand
        </button>
      </div>
      <div style={{ height: 480 }} className="rounded-lg border border-white/[0.06] bg-[#0b0f17]">
        {graph}
      </div>
    </div>
  );
}
