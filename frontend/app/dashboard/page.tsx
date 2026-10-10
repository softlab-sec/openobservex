"use client";

import { useCallback, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import Shell, { usePoll } from "@/components/Shell";
import Waterfall from "@/components/Waterfall";
import { AiButton, AiResult } from "@/components/AiPanel";
import { Card, RangePicker, Stat, colorFor } from "@/components/ui";
import {
  apiGet,
  type Application,
  apiPost,
  type EndpointStat,
  type ErrorPattern,
  type ErrorShare,
  type LatencyBucket,
  type LatencySample,
  type Overview,
  type SeriesPoint,
  type IncidentSummary,
  type ServiceStat,
  type TraceDetail,
} from "@/lib/api";

const axis = { stroke: "var(--color-border)", fontSize: 11, tick: { fill: "var(--color-text-primary)" } };
const tooltipStyle = {
  background: "var(--color-surface-card)", color: "var(--color-text-primary)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

export default function DashboardPage() {
  const [minutes, setMinutes] = useState(60);
  const [service, setService] = useState<string | null>(null);
  const [app, setApp] = useState("all");
  const [apps, setApps] = useState<Application[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);

  const [ov, setOv] = useState<Overview | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [services, setServices] = useState<ServiceStat[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([]);
  const [errPatterns, setErrPatterns] = useState<ErrorPattern[]>([]);
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [buckets, setBuckets] = useState<LatencyBucket[]>([]);
  const [share, setShare] = useState<ErrorShare[]>([]);
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<IncidentSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  const qs = useCallback(
    (extra = "") => {
      const p = new URLSearchParams({ minutes: String(minutes) });
      if (service) p.set("service", service);
      if (errorsOnly) p.set("errors_only", "true");
      if (app !== "all") p.set("app", app);
      return `${p.toString()}${extra}`;
    },
    [minutes, service, errorsOnly, app]
  );

  const load = useCallback(() => {
    return Promise.all([
      apiGet<Overview>(`/api/v1/stats/overview?${qs()}`),
      apiGet<{ points: SeriesPoint[] }>(`/api/v1/stats/timeseries?${qs()}`),
      apiGet<{ services: ServiceStat[] }>(
        `/api/v1/stats/services?minutes=${minutes}${errorsOnly ? "&errors_only=true" : ""}${app !== "all" ? `&app=${encodeURIComponent(app)}` : ""}`
      ),
      apiGet<{ endpoints: EndpointStat[] }>(`/api/v1/stats/endpoints?${qs("&limit=8")}`),
      apiGet<{ patterns: ErrorPattern[] }>(
        `/api/v1/stats/error-patterns?minutes=${minutes}&limit=8${
          service ? `&service=${encodeURIComponent(service)}` : ""
        }${app !== "all" ? `&app=${encodeURIComponent(app)}` : ""}`
      ),
      apiGet<{ samples: LatencySample[] }>(`/api/v1/stats/latency-samples?${qs("&limit=400")}`),
      apiGet<{ buckets: LatencyBucket[] }>(`/api/v1/stats/latency-distribution?${qs()}`),
      apiGet<{ share: ErrorShare[] }>(`/api/v1/stats/error-share?minutes=${minutes}${app !== "all" ? `&app=${encodeURIComponent(app)}` : ""}`),
    ])
      .then(([o, t, s, ep, epat, ls, ld, es]) => {
        setOv(o);
        setSeries(
          t.points.map((p) => ({
            ...p,
            bucket: new Date(p.bucket).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          }))
        );
        setServices(s.services);
        setEndpoints(ep.endpoints);
        setErrPatterns(epat.patterns);
        setSamples(ls.samples);
        setBuckets(ld.buckets);
        setShare(es.share);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [qs, minutes, service, errorsOnly, app]);

  usePoll(load, [minutes, service, errorsOnly, app]);

  usePoll(
    useCallback(() => apiGet<Application[]>("/api/v1/applications").then(setApps).catch(() => {}), []),
    [],
    60000
  );

  function summarize() {
    setAiLoading(true);
    setSummary(null);
    setAiUnavailable(false);
    const svc = service ? `&service=${encodeURIComponent(service)}` : "";
    apiPost<IncidentSummary & { status?: string; detail?: string }>(
      `/api/v1/ai/summarize-incident?minutes=${minutes}${svc}`
    )
      .then((data) => {
        if (data.status === "unavailable") {
          setAiUnavailable(true);
          setSummary(null);
        } else {
          setSummary(data);
        }
      })
      .catch(() => setAiUnavailable(true))
      .finally(() => setAiLoading(false));
  }

  function openTrace(id: string) {
    apiGet<TraceDetail>(`/api/v1/traces/${id}`)
      .then(setTrace)
      .catch(() => setErr("Could not load that trace"));
  }

  const filtering = service !== null || errorsOnly;

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-text-muted">
            Live service health, refreshed every 10s
          </p>
        </div>
        <div className="flex items-center gap-3">
          {apps.length > 0 && (
            <select
              value={app}
              onChange={(e) => setApp(e.target.value)}
              className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="all">All applications</option>
              {apps.map((a) => (
                <option key={a.id} value={a.namespace}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <AiButton onClick={summarize} loading={aiLoading} label="AI summary" />
          <button
            onClick={() => setErrorsOnly((v) => !v)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              errorsOnly
                ? "border-status-critical/40 bg-status-critical/15 text-status-critical"
                : "border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            Errors only
          </button>
          <RangePicker value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {filtering && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-muted">Filters:</span>
          {service && (
            <button
              onClick={() => setService(null)}
              className="rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-accent"
            >
              service: {service} &times;
            </button>
          )}
          {errorsOnly && (
            <button
              onClick={() => setErrorsOnly(false)}
              className="rounded-full border border-status-critical/40 bg-status-critical/15 px-3 py-1 text-status-critical"
            >
              errors only &times;
            </button>
          )}
          <button
            onClick={() => {
              setService(null);
              setErrorsOnly(false);
            }}
            className="text-text-muted underline hover:text-text-primary"
          >
            clear all
          </button>
        </div>
      )}

      {err && (
        <p className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          {err}
        </p>
      )}

      {summary && (
        <AiResult
          title={`Incident summary (last ${summary.window_minutes}m)`}
          headline={summary.executive_summary}
          verdict={summary.verdict}
          onClose={() => setSummary(null)}
          sections={[
            { label: "Technical detail", items: [summary.technical_summary] },
            { label: "Affected services", items: summary.affected_services },
            { label: "Suggested next steps", items: summary.suggested_next_steps },
          ]}
        />
      )}

      {aiUnavailable && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-status-warning/25 bg-status-warning/[0.06] p-4">
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-status-warning">AI interpretation is temporarily unavailable.</span>{" "}
            The dashboard findings below are complete and accurate. The AI summary is optional and can be retried.
          </div>
          <button
            onClick={summarize}
            disabled={aiLoading}
            className="ml-4 shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary transition hover:bg-surface-elevated disabled:opacity-50"
          >
            {aiLoading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat
          label="Health"
          value={ov ? Math.max(0, Math.round(100 - ov.error_rate * 4)) : "-"}
          suffix="/100"
          tone={ov ? (ov.error_rate > 5 ? "danger" : "good") : "default"}
        />
        <Stat label={service ? "Operations" : "Requests"} value={ov?.requests ?? "-"} />
        <Stat
          label="Errors"
          value={ov?.errors ?? "-"}
          tone={ov && ov.errors > 0 ? "danger" : "good"}
        />
        <Stat
          label="Error rate"
          value={ov?.error_rate ?? "-"}
          suffix="%"
          tone={ov && ov.error_rate > 5 ? "danger" : "good"}
        />
        <Stat label="Slow Response (P95)" value={ov?.p95_ms ?? "-"} suffix="ms" />
        <Stat label="Worst-Case Response (P99)" value={ov?.p99_ms ?? "-"} suffix="ms" />
      </div>

      {trace && (
        <Card className="mb-6 border-border bg-surface-elevated">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Trace waterfall</div>
              <div className="font-mono text-xs text-text-muted">
                {trace.trace_id} · {trace.span_count} spans ·{" "}
                {trace.total_ms.toFixed(2)} ms
              </div>
            </div>
            <button
              onClick={() => setTrace(null)}
              className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
            >
              Close
            </button>
          </div>
          <Waterfall detail={trace} />
        </Card>
      )}

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title={service ? "Operation volume" : "Request volume"}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-data-teal)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-data-teal)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="bucket" {...axis} tickLine={false} />
              <YAxis {...axis} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="requests"
                stroke="var(--color-data-teal)"
                fill="url(#reqFill)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="errors"
                stroke="var(--color-status-critical)"
                fill="var(--color-status-critical)" fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Latency percentiles (ms)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="bucket" {...axis} tickLine={false} />
              <YAxis {...axis} tickLine={false} width={38} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="p50_ms" name="Typical (P50)" stroke="var(--color-data-teal)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95_ms" name="Slow (P95)" stroke="var(--color-status-warning)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p99_ms" name="Worst-Case (P99)" stroke="var(--color-status-critical)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-3">
        <Card title="Request latency (click a point to open its trace)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis
                type="number"
                dataKey="ts"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                {...axis}
                tickLine={false}
              />
              <YAxis type="number" dataKey="ms" {...axis} tickLine={false} width={40} />
              <ZAxis range={[28, 28]} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) =>
                  name === "ts"
                    ? new Date(Number(value)).toLocaleTimeString()
                    : String(value)
                }
              />
              <Scatter
                data={samples}
                onClick={(d) => {
                  const id = (d as unknown as { trace_id?: string })?.trace_id;
                  if (id) openTrace(id);
                }}
                cursor="pointer"
              >
                {samples.map((s, i) => (
                  <Cell
                    key={i}
                    fill={s.status === "Error" ? "var(--color-status-critical)" : "var(--color-data-teal)"}
                    fillOpacity={s.status === "Error" ? 0.95 : 0.55}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Errors by service">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} />
              <Pie
                data={share}
                dataKey="errors"
                nameKey="service"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                onClick={(d) => {
                  const n = (d as unknown as { name?: string })?.name;
                  if (n) setService(n);
                }}
                cursor="pointer"
              >
                {share.map((s) => (
                  <Cell key={s.service} fill={colorFor(s.service)} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          {share.length === 0 && (
            <p className="-mt-24 text-center text-sm text-text-muted">No errors</p>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Latency distribution">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={buckets}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="bucket" {...axis} tickLine={false} />
              <YAxis {...axis} tickLine={false} width={38} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-hover)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="requests" name="requests" fill="var(--color-data-teal)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="errors" name="errors" fill="var(--color-status-critical)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Traffic by service">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={services} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" {...axis} tickLine={false} />
              <YAxis
                type="category"
                dataKey="ServiceName"
                {...axis}
                tickLine={false}
                width={120}
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-hover)" }} />
              <Bar
                dataKey="spans"
                radius={[0, 4, 4, 0]}
                onClick={(d) => {
                  const n = (d as unknown as { ServiceName?: string })?.ServiceName;
                  if (n) setService(n);
                }}
                cursor="pointer"
              >
                {services.map((s) => (
                  <Cell key={s.ServiceName} fill={colorFor(s.ServiceName)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card title="Top endpoints">
          <table className="w-full text-left text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="py-2 font-medium">Endpoint</th>
                <th className="py-2 font-medium">Reqs</th>
                <th className="py-2 font-medium">Err %</th>
                <th className="py-2 font-medium">Slow (P95)</th>
                <th className="py-2 font-medium">Worst-Case (P99)</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.endpoint} className="border-t border-border-subtle">
                  <td className="py-2 font-mono text-xs text-text-primary">{e.endpoint}</td>
                  <td className="py-2 tabular-nums">{e.requests}</td>
                  <td
                    className={`py-2 tabular-nums ${
                      e.error_rate > 5 ? "text-status-critical" : "text-text-secondary"
                    }`}
                  >
                    {e.error_rate}%
                  </td>
                  <td className="py-2 tabular-nums text-text-secondary">{e.p95_ms}</td>
                  <td className="py-2 tabular-nums text-text-secondary">{e.p99_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {endpoints.length === 0 && (
            <p className="py-4 text-center text-sm text-text-muted">No data</p>
          )}
        </Card>

        <Card title="Top error patterns">
          <table className="w-full text-left text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="py-2 font-medium">Service</th>
                <th className="py-2 font-medium">Message</th>
                <th className="py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {errPatterns.map((e, i) => (
                <tr
                  key={i}
                  onClick={() => setService(e.service)}
                  className="cursor-pointer border-t border-border-subtle hover:bg-surface-elevated"
                >
                  <td className="py-2 whitespace-nowrap text-text-secondary">{e.service}</td>
                  <td className="py-2 font-mono text-xs text-status-critical/90">{e.pattern}</td>
                  <td className="py-2 tabular-nums">{e.occurrences}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errPatterns.length === 0 && (
            <p className="py-4 text-center text-sm text-text-muted">
              No errors in this window
            </p>
          )}
        </Card>
      </div>

      <Card title="Services">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="py-2 font-medium">Service</th>
                <th className="py-2 font-medium">Spans</th>
                <th className="py-2 font-medium">Errors</th>
                <th className="py-2 font-medium">Error rate</th>
                <th className="py-2 font-medium">Avg</th>
                <th className="py-2 font-medium">Slow (P95)</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr
                  key={s.ServiceName}
                  onClick={() =>
                    setService(service === s.ServiceName ? null : s.ServiceName)
                  }
                  className={`cursor-pointer border-t border-border-subtle transition ${
                    service === s.ServiceName
                      ? "bg-accent/15 ring-1 ring-inset ring-accent/40"
                      : "hover:bg-surface-elevated"
                  }`}
                >
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: colorFor(s.ServiceName) }}
                      />
                      {s.ServiceName}
                    </span>
                  </td>
                  <td className="py-2 tabular-nums">{s.spans}</td>
                  <td className="py-2 tabular-nums">{s.errors}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded bg-surface-hover">
                        <div
                          className="h-1.5 rounded bg-status-critical"
                          style={{ width: `${Math.min(s.error_rate * 4, 100)}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-text-secondary">{s.error_rate}%</span>
                    </div>
                  </td>
                  <td className="py-2 tabular-nums text-text-secondary">{s.avg_ms} ms</td>
                  <td className="py-2 tabular-nums text-text-secondary">{s.p95_ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}
