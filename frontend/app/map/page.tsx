"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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

function ServiceNode({ data }: { data: NodeData }) {
  const [hover, setHover] = useState(false);
  const bad = data.errorRate > 2;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => data.onOpen(data.label)}
      className={`relative cursor-pointer rounded-xl border px-4 py-3 text-center shadow-lg transition ${
        bad
          ? "border-red-400/60 bg-red-500/10 hover:border-red-300"
          : "border-white/15 bg-[#151b26] hover:border-white/40"
      }`}
      style={{ minWidth: 150 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-white/30" />
      <div className="flex items-center justify-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: colorFor(data.label) }}
        />
        <span className="text-sm font-medium text-white/90">{data.label}</span>
      </div>
      <div className="mt-1 text-[11px] text-white/45">
        {data.calls.toLocaleString()} calls
        {data.errorRate > 0 && (
          <span className={bad ? "text-red-300" : "text-amber-300"}>
            {" "}
            · {data.errorRate}% err
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-white/30" />

      {hover && (
        <div className="absolute left-1/2 top-full z-10 mt-2 w-44 -translate-x-1/2 rounded-lg border border-white/15 bg-[#0b0f17] p-2 text-left text-[11px] shadow-xl">
          <div className="mb-1 font-medium text-white/80">{data.label}</div>
          <div className="flex justify-between text-white/50">
            <span>calls</span>
            <span className="tabular-nums">{data.calls.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-white/50">
            <span>error rate</span>
            <span className={bad ? "text-red-300" : "text-white/70"}>
              {data.errorRate}%
            </span>
          </div>
          <div className="mt-1 text-center text-white/30">click for detail</div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

function layout(nodes: string[], edges: MapEdge[]) {
  const targets = new Set(edges.map((e) => e.target));
  const bySource: Record<string, string[]> = {};
  edges.forEach((e) => (bySource[e.source] ??= []).push(e.target));

  const depth: Record<string, number> = {};
  const roots = nodes.filter((n) => !targets.has(n));
  const queue: [string, number][] = (roots.length ? roots : nodes.slice(0, 1)).map(
    (n) => [n, 0]
  );
  const seen = new Set<string>();
  while (queue.length) {
    const [n, d] = queue.shift()!;
    if (seen.has(n)) {
      depth[n] = Math.max(depth[n] ?? 0, d);
      continue;
    }
    seen.add(n);
    depth[n] = d;
    (bySource[n] ?? []).forEach((t) => queue.push([t, d + 1]));
  }
  nodes.forEach((n) => (depth[n] ??= 0));

  const perCol: Record<number, number> = {};
  return nodes.map((n) => {
    const col = depth[n];
    const row = perCol[col] ?? 0;
    perCol[col] = row + 1;
    return { id: n, col, row };
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

export default function ServiceMapPage() {
  const [minutes, setMinutes] = useState(60);
  const [app, setApp] = useState("all");
  const [apps, setApps] = useState<Application[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
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

        const placed = layout(data.nodes, data.edges);
        const rn: Node[] = placed.map((p) => {
          const c = calls[p.id] ?? 0;
          const e = errs[p.id] ?? 0;
          return {
            id: p.id,
            type: "service",
            position: { x: p.col * 300, y: p.row * 130 },
            data: {
              label: p.id,
              calls: c,
              errorRate: c ? Math.round((e / c) * 1000) / 10 : 0,
              onOpen: openService,
            },
          };
        });

        const maxCalls = Math.max(...data.edges.map((e) => e.calls), 1);
        const re: Edge[] = data.edges.map((e, i) => {
          const bad = e.calls > 0 && e.errors / e.calls > 0.02;
          return {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            animated: bad,
            label: `${e.calls} · ${e.avg_ms}ms`,
            labelStyle: { fill: "#ffffff70", fontSize: 10 },
            labelBgStyle: { fill: "#0b0f17", fillOpacity: 0.85 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
            type: "smoothstep",
            style: {
              stroke: bad ? "#f87171" : "#38bdf8",
              strokeWidth: 1.5 + (e.calls / maxCalls) * 4,
              opacity: 0.6,
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
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#ffffff10" gap={22} />
        <Controls className="!bg-[#151b26] !border-white/10" />
      </ReactFlow>
    ),
    [nodes, edges]
  );

  return (
    <Shell>
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
        style={{ height: "74vh" }}
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
