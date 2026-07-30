"""OpenObserveX Ingest Gateway.

Sits in front of the OTel Collector. For every incoming OTLP/HTTP request it:
  1. validates the Bearer API key against Postgres (SHA-256 hash lookup),
  2. resolves the key's real tenant.id + service.namespace,
  3. STRIPS any sender-supplied tenant.id / service.namespace from the payload
     and injects the verified values (anti-spoofing),
  4. forwards the sanitized protobuf to the collector's OTLP/HTTP endpoint.

A sender can only write into the tenant its key belongs to — claimed tags are
overwritten, never trusted.
"""

import hashlib
import os

import httpx
import psycopg
from fastapi import FastAPI, Header, HTTPException, Request, Response

from opentelemetry.proto.collector.trace.v1 import trace_service_pb2
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2
from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2
from opentelemetry.proto.common.v1 import common_pb2

COLLECTOR = os.getenv("COLLECTOR_HTTP", "http://otel-collector:4318")
PG_DSN = os.getenv("PG_DSN", "postgresql://oox:oox@postgres:5432/openobservex")

app = FastAPI(title="OpenObserveX Ingest Gateway")

_SIGNALS = {
    "traces": (trace_service_pb2.ExportTraceServiceRequest, "resource_spans"),
    "logs": (logs_service_pb2.ExportLogsServiceRequest, "resource_logs"),
    "metrics": (metrics_service_pb2.ExportMetricsServiceRequest, "resource_metrics"),
}


def _resolve_tenant(api_key: str) -> tuple[str, str] | None:
    """Look up a key's (tenant_tag, namespace) by SHA-256 hash. None if invalid/revoked."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    with psycopg.connect(PG_DSN, autocommit=True) as conn:
        row = conn.execute(
            """
            SELECT a.tenant_tag, a.namespace
            FROM api_keys k JOIN applications a ON k.application_id = a.id
            WHERE k.key_hash = %s AND k.revoked_at IS NULL
            """,
            (key_hash,),
        ).fetchone()
        if row:
            conn.execute("UPDATE api_keys SET last_used_at = now() WHERE key_hash = %s", (key_hash,))
        return (row[0], row[1]) if row else None


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

    resolved = _resolve_tenant(api_key)
    if not resolved:
        raise HTTPException(403, "invalid or revoked api key")
    tenant, namespace = resolved

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
