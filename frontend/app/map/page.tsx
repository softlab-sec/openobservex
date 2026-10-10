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
  failing: { ring: "var(--color-status-critical)", glow: "rgba(248,113,113,0.55)", text: "text-status-critical" },
  degraded: { ring: "var(--color-status-warning)", glow: "rgba(251,191,36,0.4)", text: "text-status-warning" },
  healthy: { ring: "var(--color-status-healthy)", glow: "rgba(52,211,153,0.35)", text: "text-status-healthy" },
};

function ServiceNode({ data }: { data: NodeData }) {
  const [hover, setHover] = useState(false);
  const health = (data.health ?? "healthy") as "healthy" | "degraded" | "failing";
  const isRoot = data.isRoot ?? false;
  const dim = data.dim ?? false;
  const isFocus = data.isFocus ?? false;
  const hr = isRoot ? { ring: "var(--color-accent)", glow: "rgba(56,189,248,0.35)", text: "text-status-info" } : HEALTH_RING[health];
  const dia = isFocus ? 74 : 60;
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: dia, height: dia, opacity: dim ? 0.28 : 1 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => data.onOpen(data.label)}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-surface-hover" style={{ left: -2 }} />
      <div
        className="flex cursor-pointer items-center justify-center rounded-full transition"
        style={{
          width: dia,
          height: dia,
          background: "#FFFFFF",
          border: `${isFocus ? 4 : 3}px solid ${hr.ring}`,
          boxShadow: `0 0 ${isFocus ? 28 : 14}px -4px ${hr.glow}${isFocus ? ", 0 0 0 4px rgba(56,189,248,0.25)" : ""}`,
        }}
      >
        <span className="text-xs font-bold text-text-primary">
          {isRoot ? data.calls.toLocaleString() : data.nodeErrorPct > 0 ? `${data.nodeErrorPct}%` : `${data.p95_ms}ms`}
        </span>
      </div>
      <div className="absolute left-1/2 top-full mt-1.5 w-[170px] -translate-x-1/2 text-center pointer-events-none">
        <div className="truncate text-sm font-bold text-text-primary">{data.label}</div>
        <div className={`text-[12px] font-medium ${isRoot ? "text-status-info/70" : data.nodeErrorPct > 0 ? hr.text : "text-text-muted"}`}>
          {isRoot ? `entry · ${data.calls.toLocaleString()} calls` : `${data.calls.toLocaleString()} calls · p95 ${data.p95_ms}ms`}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-surface-hover" style={{ right: -2 }} />

      <NodeToolbar isVisible={hover} position={data.flipUp ? Position.Top : Position.Bottom} offset={12}>
        <div className="w-64 rounded-xl border border-border bg-surface-card p-3 text-left shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-text-primary">{data.label}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isRoot ? "bg-status-info/15 text-status-info"
              : health === "failing" ? "bg-status-critical/15 text-status-critical"
              : health === "degraded" ? "bg-status-warning/15 text-status-warning"
              : "bg-status-healthy/15 text-status-healthy"}`}>
              {isRoot ? "Entry point" : health === "failing" ? "Failing" : health === "degraded" ? "Degraded" : "Healthy"}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-text-muted">Calls</span><span className="text-text-secondary">{data.calls.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Error rate</span><span className={data.nodeErrorPct > 0 ? hr.text : "text-text-secondary"}>{data.nodeErrorPct}%</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Latency</span><span className="text-text-secondary">{data.p95_ms}ms</span></div>
          </div>
          <div className="mt-2 border-t border-border pt-1.5 text-center text-[11px] text-text-muted">click for detail</div>
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
    <div className="absolute right-0 top-0 z-20 h-full w-96 overflow-y-auto border-l border-border bg-surface-card p-5 shadow-2xl">
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
          className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
        >
          Close
        </button>
      </div>

      {loading && <p className="text-sm text-text-muted">Loading detail...</p>}

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
                className="rounded-lg border border-border bg-surface-elevated p-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
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
            className="mt-4 block rounded-lg border border-status-info/40 bg-status-info/15 px-3 py-2 text-center text-sm text-status-info hover:bg-status-info/25"
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
      <div className="mb-1 text-xs uppercase tracking-wider text-text-muted">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ left, right, bad }: { left: string; right: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-elevated px-2 py-1.5 text-sm">
      <span className={`truncate ${bad ? "text-status-critical" : "text-text-secondary"}`}>
        {left}
      </span>
      <span className="shrink-0 pl-2 tabular-nums text-text-muted">{right}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-sm text-text-muted">{children}</div>;
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

        const calls: Record<string, number> = {}; const out: Record<string, number> = {}; const outP95: Record<string, number> = {};
        const errs: Record<string, number> = {};
        data.edges.forEach((e) => {
          calls[e.target] = (calls[e.target] ?? 0) + e.calls;
          errs[e.target] = (errs[e.target] ?? 0) + e.errors;
          calls[e.source] = calls[e.source] ?? 0; out[e.source] = (out[e.source] ?? 0) + e.calls; outP95[e.source] = Math.max(outP95[e.source] ?? 0, e.p95_ms ?? 0);
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
          const c = calls[p.id] || out[p.id] || 0;
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
              p95_ms: nodeById[p.id]?.p95_ms || outP95[p.id] || 0,
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
          const stroke = failing ? "var(--color-status-critical)" : degraded ? "var(--color-status-warning)" : "var(--color-accent)";
          const edgeDim = focus ? !(inBlast.has(e.source) && inBlast.has(e.target)) : false;
          return {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            animated: failing,
            label: ep > 0 ? `${e.calls} · ${ep}% err · p95 ${e.p95_ms}ms` : `${e.calls} · p95 ${e.p95_ms}ms`,
            labelStyle: { fill: "var(--color-text-secondary)", fontSize: 10 },
            labelBgStyle: { fill: "var(--color-surface-card)", fillOpacity: 0.85 },
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
        <Controls className="!bg-surface-elevated !border-border [&_button]:!bg-surface-elevated [&_button]:!border-border [&_button:hover]:!bg-surface-hover [&_button]:!fill-text-secondary" />
      </ReactFlow>
    ),
    [nodes, edges]
  );

  return (
    <Shell>
      {focus && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-status-critical/25 bg-status-critical/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-critical/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-status-critical" />
            </span>
            <span className="text-sm text-text-secondary">
              Blast radius for <span className="font-semibold text-status-critical">{focus}</span>
              <span className="text-text-muted"> · incident context</span>
            </span>
          </div>
          {fromIncident && (
            <a href={`/incidents/${fromIncident}`}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs text-text-secondary transition hover:bg-surface-elevated">
              <span>←</span> Back to incident
            </a>
          )}
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service map</h1>
          <p className="text-sm text-text-muted">
            Dependencies inferred from traces. Click a node to drill in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={app}
            onChange={(e) => setApp(e.target.value)}
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-border"
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
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {err}
        </p>
      )}

      <div
        className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated"
        style={{ height: "calc(100vh - 150px)" }}
      >
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
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
    <Suspense fallback={<Shell><p className="text-sm text-text-muted">Loading map…</p></Shell>}>
      <ServiceMapInner />
    </Suspense>
  );
}
