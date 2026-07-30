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

export type ServiceMap = {
  nodes: string[];
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
