const TOKEN_KEY = "oox_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(email: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username: email, password });
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Invalid email or password");
  const data = await res.json();
  return data.access_token as string;
}

export type RegisterPayload = {
  full_name: string;
  email: string;
  password: string;
  job_title?: string;
  department?: string;
  phone?: string;
  organization_name: string;
  industry?: string;
  company_size?: string;
  country?: string;
};

export async function register(payload: RegisterPayload): Promise<void> {
  const res = await fetch("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Registration failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg)
        msg = data.detail[0].msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
}

/** Called whenever the server rejects our token. Ends the session once. */
let loggingOut = false;
function forceLogout(): void {
  if (loggingOut) return;
  loggingOut = true;
  clearToken();
  if (typeof window !== "undefined") {
    window.location.replace("/login?expired=1");
  }
}

export async function apiPost<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    forceLogout();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let msg = `request failed: ${res.status}`;
    try {
      const d = await res.json();
      if (typeof d.detail === "string") msg = d.detail;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    forceLogout();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let msg = `request failed: ${res.status}`;
    try {
      const d = await res.json();
      if (typeof d.detail === "string") msg = d.detail;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    // Token expired or invalid: drop the session everywhere, not just here.
    forceLogout();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

/* ---------- shared types ---------- */

export type Me = { email: string; role: string; organization_id: string };
export type OidcStatus = { enabled: boolean; provider_name: string };

export type AuditRow = {
  id: string;
  created_at: string;
  actor_email: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  detail: string | null;
};
export type AuditPage = {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
};

export type Overview = {
  requests: number;
  errors: number;
  error_rate: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  traces: number;
};

export type SeriesPoint = {
  bucket: string;
  requests: number;
  errors: number;
  p95_ms: number;
};

export type ServiceStat = {
  ServiceName: string;
  spans: number;
  errors: number;
  error_rate: number;
  avg_ms: number;
  p95_ms: number;
};

export type TraceRow = {
  TraceId: string;
  Timestamp: string;
  ServiceName: string;
  SpanName: string;
  duration_ms: number;
  StatusCode: string;
  span_count: number;
};

export type Span = {
  SpanId: string;
  ParentSpanId: string;
  ServiceName: string;
  SpanName: string;
  SpanKind: string;
  StatusCode: string;
  StatusMessage: string;
  duration_ms: number;
  offset_ms: number;
  SpanAttributes: Record<string, string>;
};

export type TraceDetail = {
  trace_id: string;
  span_count: number;
  total_ms: number;
  spans: Span[];
};

export type LogRow = {
  Timestamp: string;
  ServiceName: string;
  SeverityText: string;
  Body: string;
  TraceId: string;
  SpanId: string;
};

export type EndpointStat = {
  endpoint: string;
  service: string;
  requests: number;
  errors: number;
  error_rate: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

export type ErrorPattern = {
  service: string;
  pattern: string;
  occurrences: number;
  last_seen: string;
};

export type MapEdge = {
  source: string;
  target: string;
  calls: number;
  errors: number;
  avg_ms: number;
  p95_ms: number;
  error_pct: number;
};

export type LatencySample = {
  ts: number;
  ms: number;
  endpoint: string;
  status: string;
  trace_id: string;
};

export type LatencyBucket = {
  bucket: string;
  sortOrder: number;
  requests: number;
  errors: number;
};

export type ErrorShare = { service: string; errors: number };

export type AiStatus = { available: boolean; models: string[] };

export type TraceAnalysis = {
  trace_id: string;
  span_count: number;
  verdict: "healthy" | "degraded" | "failed";
  probable_cause: string;
  confidence: "low" | "medium" | "high";
  impact: string;
  evidence: string[];
  remediation: string[];
};

export type IncidentSummary = {
  window_minutes: number;
  verdict: "healthy" | "degraded" | "critical";
  executive_summary: string;
  technical_summary: string;
  affected_services: string[];
  suggested_next_steps: string[];
};

export type MapNode = {
  id: string;
  calls: number;
  error_pct: number;
  p95_ms: number;
  health: "healthy" | "degraded" | "failing";
};
export type ServiceMap = {
  nodes: MapNode[];
  edges: MapEdge[];
};

export type ServiceDetail = {
  service: string;
  totals: {
    spans: number;
    errors: number;
    error_rate: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  operations: { operation: string; calls: number; errors: number; p95_ms: number }[];
  upstream: { service: string; calls: number }[];
  downstream: { service: string; calls: number; errors: number }[];
};

export type InfraSummary = {
  cpu_pct: number;
  memory_pct: number;
  disk_pct: number;
  memory_total_gb: number;
  disk_total_gb: number;
  load1: number;
  load5: number;
  load15: number;
};
export type ContainerStat = { container: string; mem_mb: number };

export type InfraPoint = { bucket: string; memory_pct: number; load1: number };
export type NetPoint = { bucket: string; rx_bps: number; tx_bps: number };
export type FsRow = { mount: string; size_gb: number; used_pct: number };
export type InfraAi = { verdict: "healthy" | "watch" | "critical"; headline: string; details: string[] };

export type CpuCore = { core: string; busy_pct: number };
export type MemSlice = { name: string; gb: number };
export type MemBreakdown = { breakdown: MemSlice[]; swap_used_gb: number; swap_total_gb: number };
export type DiskPoint = { bucket: string; read_bps: number; write_bps: number };

export type Application = {
  id: string;
  name: string;
  tenant_tag: string;
  namespace: string;
  created_at: string;
};

export type ApiKeyRow = {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
export type ApiKeyCreated = {
  id: string;
  prefix: string;
  name: string;
  full_key: string;
};

export type NotificationChannel = {
  id: string;
  name: string;
  kind: "email" | "slack" | "discord" | "webhook";
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
};

export type IncidentRow = {
  id: string;
  rule_id: string;
  rule_name: string;
  kind: string;
  service: string | null;
  status: "firing" | "resolved";
  severity: "critical" | "warning" | "info";
  observed_value: number;
  threshold: number;
  summary: string;
  analysis: AnomalyAnalysis;
  started_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  assigned_to: string | null;
};

export type IncidentEvent = {
  id: string;
  kind: string;
  actor: string | null;
  detail: string | null;
  created_at: string;
};

export type AlertRule = {
  id: string;
  name: string;
  kind: "error_rate" | "latency" | "log_spike" | "service_down";
  service: string | null;
  operator: ">" | "<" | ">=" | "<=" | "=" | "!=";
  threshold: number;
  percentile: number;
  for_minutes: number;
  min_samples: number;
  enabled: boolean;
  severity: "critical" | "warning" | "info";
  webhook_urls: string | null;
  channel_ids: string | null;
  created_at: string;
  is_firing?: boolean;
  last_fired_at?: string | null;
  incident_count?: number;
};

export type AlertRuleInput = Omit<AlertRule, "id" | "created_at" | "is_firing" | "last_fired_at" | "incident_count">;

export type AffectedService = {
  service: string;
  errors: number;
  total: number;
  error_rate: number;
  p95_ms: number;
};
export type SampleTrace = {
  trace_id: string;
  service: string;
  operation: string;
  duration_ms: number;
  ts: string;
};
export type TrendPoint = {
  bucket: string;
  error_rate: number;
  errors: number;
  total: number;
};
export type IncidentTrigger = {
  service: string;
  endpoint: string;
  error: string;
  occurrences: number;
  p95_ms: number;
  last_seen: string;
};

export type IncidentAnalysis = {
  impact: {
    affected_services: number;
    affected_operations: number;
    failed_requests: number;
    user_impact: string;
    likely_cause: string;
  };
  rca: {
    likely_cause: string;
    confidence: string;
    evidence: string[];
    contributing_factors: string[];
  };
  contributions: {
    service: string;
    endpoint: string;
    detail: string;
    occurrences: number;
    p95_ms: number;
    contribution_pct: number;
  }[];
  guidance: string[];
};

export type IncidentEvidence = {
  analysis?: IncidentAnalysis;
  triggers: IncidentTrigger[];
  incident_id: string;
  service: string | null;
  observed_value: number;
  threshold: number;
  kind: string;
  affected_services: AffectedService[];
  error_patterns: ErrorPattern[];
  sample_traces: SampleTrace[];
  trend: TrendPoint[];
};

export type AnomalyRow = {
  id: string;
  service: string;
  metric: "error_rate" | "p95_latency";
  observed: number;
  baseline_mean: number;
  baseline_std: number;
  z_score: number;
  severity: "critical" | "warning" | "info";
  status: "active" | "resolved";
  occurrences: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  promoted_incident_id: string | null;
  resolution: string;
};

export type AnomalyTrigger = {
  service: string;
  endpoint: string;
  error: string;
  occurrences: number;
  p95_ms: number;
  last_seen: string;
};
export type AnomalyTrendPoint = { bucket: string; value: number };

export type AnomalyAnalysis = {
  impact: {
    affected_services: number;
    affected_operations: number;
    failed_requests: number;
    user_impact: string;
    likely_cause: string;
  pattern: {
    pattern: string;
    signals: string[];
    description: string;
  };
};
  rca: {
    likely_cause: string;
    confidence: string;
    evidence: string[];
    contributing_factors: string[];
  };
  why_detected: {
    metric: string;
    observed: string;
    baseline: string;
    deviation: string;
    threshold: string;
    reason: string;
  };
  contributions: {
    service: string;
    endpoint: string;
    detail: string;
    occurrences: number;
    p95_ms: number;
    contribution_pct: number;
  }[];
  guidance: string[];
};

export type AnomalyEvidence = {
  anomaly_id: string;
  service: string | null;
  metric: string;
  observed: number;
  baseline_mean: number;
  z_score: number;
  summary: string;
  affected_services: AffectedService[];
  triggers: AnomalyTrigger[];
  sample_traces: SampleTrace[];
  trend: AnomalyTrendPoint[];
};

export type SystemStorageEntry = { rows: number | null; per_min_5m: number | null };
export type SystemHealth = {
  generated_at: number;
  status: "healthy" | "degraded" | "down";
  clickhouse_up: boolean;
  clickhouse_query_ms: number | null;
  postgres_up: boolean;
  postgres_query_ms: number | null;
  ingest_lag_seconds: number | null;
  storage: { traces: SystemStorageEntry; logs: SystemStorageEntry; metrics: SystemStorageEntry };
  components: Record<string, boolean>;
};

export type MaintenanceWindow = {
  id: string;
  reason: string;
  service: string | null;
  starts_at: string;
  ends_at: string;
  created_by: string | null;
  created_at: string;
  active: boolean;
};

export type Slo = {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  team: string | null;
  tags: string | null;
  sli_type: "availability" | "latency";
  target_kind: "service" | "api" | "endpoint" | "infrastructure";
  service: string | null;
  target_ref: string | null;
  target: number;
  window_days: number;
  latency_threshold_ms: number | null;
  enabled: boolean;
  current_sli: number | null;
  budget_remaining_pct: number | null;
  burn_rate: number | null;
  total_events: number | null;
  is_meeting: boolean | null;
  last_evaluated_at: string | null;
  created_at: string;
};

export type SloInput = {
  name: string;
  description?: string | null;
  owner?: string | null;
  team?: string | null;
  tags?: string | null;
  sli_type: "availability" | "latency";
  target_kind?: "service" | "api" | "endpoint" | "infrastructure";
  service?: string | null;
  target_ref?: string | null;
  target: number;
  window_days: number;
  latency_threshold_ms?: number | null;
  enabled?: boolean;
};

export type SloInventory = {
  services: string[];
  endpoints: { service: string; endpoint: string }[];
  infrastructure: string[];
};
