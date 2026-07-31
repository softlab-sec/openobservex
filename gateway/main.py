"""OpenObserveX Ingest Gateway.

Pipeline for every OTLP/HTTP request:
  1. validate Bearer API key (SHA-256 hash lookup in Postgres, not revoked),
  2. entitlement gate: reject if the owning org's status != 'active' (403),
  3. rate limit: per-key sliding window in Redis; over quota -> 429,
  4. anti-spoof: strip sender-supplied tenant.id/service.namespace, inject the
     verified values derived from the key,
  5. forward sanitized protobuf to the collector.
"""

import hashlib
import os
import time

import httpx
import psycopg
import redis
from fastapi import FastAPI, Header, HTTPException, Request, Response

from opentelemetry.proto.collector.trace.v1 import trace_service_pb2
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2
from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2
from opentelemetry.proto.common.v1 import common_pb2

COLLECTOR = os.getenv("COLLECTOR_HTTP", "http://otel-collector:4318")
PG_DSN = os.getenv("PG_DSN", "postgresql://oox:oox@postgres:5432/openobservex")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

app = FastAPI(title="OpenObserveX Ingest Gateway")
_redis = redis.from_url(REDIS_URL, decode_responses=True)

_SIGNALS = {
    "traces": (trace_service_pb2.ExportTraceServiceRequest, "resource_spans"),
    "logs": (logs_service_pb2.ExportLogsServiceRequest, "resource_logs"),
    "metrics": (metrics_service_pb2.ExportMetricsServiceRequest, "resource_metrics"),
}


def _resolve_key(api_key: str):
    """Return (tenant_tag, namespace, org_status, rate_limit_rps, prefix) or None."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    with psycopg.connect(PG_DSN, autocommit=True) as conn:
        row = conn.execute(
            """
            SELECT a.tenant_tag, a.namespace, o.status, k.rate_limit_rps, k.prefix
            FROM api_keys k
            JOIN applications a ON k.application_id = a.id
            JOIN organizations o ON a.organization_id = o.id
            WHERE k.key_hash = %s AND k.revoked_at IS NULL
            """,
            (key_hash,),
        ).fetchone()
        if row:
            conn.execute("UPDATE api_keys SET last_used_at = now() WHERE key_hash = %s", (key_hash,))
        return row


def _rate_ok(prefix: str, limit: int) -> bool:
    """Fixed 1-second window per key via Redis INCR + EXPIRE. Fail-open if Redis down."""
    try:
        bucket = f"rl:{prefix}:{int(time.time())}"
        count = _redis.incr(bucket)
        if count == 1:
            _redis.expire(bucket, 2)
        return count <= limit
    except redis.RedisError:
        return True


def _enforce(raw: bytes, signal: str, tenant: str, namespace: str) -> bytes:
    msg_cls, field = _SIGNALS[signal]
    msg = msg_cls()
    msg.ParseFromString(raw)
    for rr in getattr(msg, field):
        attrs = rr.resource.attributes
        keep = [kv for kv in attrs if kv.key not in ("tenant.id", "service.namespace")]
        del attrs[:]
        for kv in keep:
            attrs.append(kv)
        attrs.append(common_pb2.KeyValue(key="tenant.id",
                     value=common_pb2.AnyValue(string_value=tenant)))
        attrs.append(common_pb2.KeyValue(key="service.namespace",
                     value=common_pb2.AnyValue(string_value=namespace)))
    return msg.SerializeToString()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/{signal}")
async def ingest(signal: str, request: Request, authorization: str = Header(None)):
    if signal not in _SIGNALS:
        raise HTTPException(404, "unknown signal")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing api key")
    api_key = authorization.removeprefix("Bearer ").strip()

    row = _resolve_key(api_key)
    if not row:
        raise HTTPException(403, "invalid or revoked api key")
    tenant, namespace, org_status, rate_limit, prefix = row

    if org_status != "active":
        raise HTTPException(403, f"organization is {org_status}")

    if not _rate_ok(prefix, rate_limit):
        raise HTTPException(429, "rate limit exceeded")

    raw = await request.body()
    try:
        sanitized = _enforce(raw, signal, tenant, namespace)
    except Exception:
        raise HTTPException(400, "malformed OTLP payload")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{COLLECTOR}/v1/{signal}",
            content=sanitized,
            headers={"Content-Type": "application/x-protobuf"},
        )
    return Response(content=resp.content, status_code=resp.status_code,
                    media_type=resp.headers.get("content-type", "application/x-protobuf"))
