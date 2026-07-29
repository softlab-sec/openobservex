"""AI-assisted analysis backed by a local Ollama model.

Every endpoint gathers real telemetry from ClickHouse first, then asks the
model to interpret only that evidence. The model never queries anything
itself, so its answers stay grounded in data we actually retrieved.

Endpoints are async and dispatch the slow model call onto a dedicated pool,
so a 60s inference never occupies a request-serving worker.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import get_current_user
from app.db.clickhouse import ch_query
from app.models import User
from app.services import ollama

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

SYSTEM = (
    "You are a senior site reliability engineer doing root-cause analysis on ONE "
    "distributed trace. Rules you MUST follow:\n"
    "1. If any span has status=Error, the verdict is 'failed' (or 'degraded' if "
    "the request still completed). It is NEVER 'healthy' when a span errored.\n"
    "2. Anchor your analysis on the SPECIFIC failing spans and their error "
    "messages. Name the exact service, operation, and error text you were given. "
    "Two different traces must produce two different analyses.\n"
    "3. Only call it 'healthy' when every span has status=Unset/Ok.\n"
    "4. Never output generic filler like 'within reasonable range' when there is "
    "a concrete error to explain. Explain THAT error.\n"
    "Be concise and specific: cite services, operations, durations, and the "
    "actual error messages from the evidence."
)

RCA_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["healthy", "degraded", "failed"]},
        "probable_cause": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "impact": {"type": "string"},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "remediation": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "verdict",
        "probable_cause",
        "confidence",
        "impact",
        "evidence",
        "remediation",
    ],
}

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["healthy", "degraded", "critical"]},
        "executive_summary": {"type": "string"},
        "technical_summary": {"type": "string"},
        "affected_services": {"type": "array", "items": {"type": "string"}},
        "suggested_next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "verdict",
        "executive_summary",
        "technical_summary",
        "affected_services",
        "suggested_next_steps",
    ],
}


def _rows(result) -> list[dict]:
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def _require_model() -> None:
    if not ollama.is_available():
        raise HTTPException(
            status_code=503,
            detail="Local model server is unavailable. Is the ollama container running?",
        )


@router.get("/status")
def ai_status():
    available = ollama.is_available()
    return {
        "available": available,
        "models": ollama.installed_models() if available else [],
    }


@router.post("/analyze-trace/{trace_id}")
async def analyze_trace(trace_id: str, _user: User = Depends(get_current_user)):
    if not trace_id.isalnum() or len(trace_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid trace id")
    _require_model()

    spans = _rows(
        ch_query(
            """
            SELECT ServiceName, SpanName, SpanKind, StatusCode, StatusMessage,
                   round(Duration / 1000000, 2) AS duration_ms, SpanAttributes
            FROM otel_traces
            WHERE TraceId = {tid:String}
            ORDER BY Timestamp ASC
            """,
            {"tid": trace_id},
        )
    )
    if not spans:
        raise HTTPException(status_code=404, detail="Trace not found")

    logs = _rows(
        ch_query(
            """
            SELECT ServiceName, SeverityText, Body
            FROM otel_logs
            WHERE TraceId = {tid:String}
            ORDER BY Timestamp ASC
            LIMIT 50
            """,
            {"tid": trace_id},
        )
    )

    error_spans = [s for s in spans if s["StatusCode"] == "Error"]
    total = max((s["duration_ms"] for s in spans), default=0)
    child = [s for s in spans if s["SpanKind"] != "SPAN_KIND_SERVER"]
    slowest = max(child, key=lambda s: s["duration_ms"], default=None)

    span_lines = "\n".join(
        f"- {s['ServiceName']} | {s['SpanName']} | {s['SpanKind']} | "
        f"{s['duration_ms']}ms | status={s['StatusCode']}"
        + (f" | error=\"{s['StatusMessage']}\"" if s["StatusMessage"] else "")
        for s in spans
    )
    log_lines = "\n".join(
        f"- [{l['SeverityText']}] {l['ServiceName']}: {l['Body']}" for l in logs
    ) or "(no correlated logs)"

    if error_spans:
        failing = "\n".join(
            f"- {s['ServiceName']} / {s['SpanName']}: "
            f"{s['StatusMessage'] or 'errored with no message'}"
            for s in error_spans
        )
        focus = (
            f"THIS TRACE FAILED. {len(error_spans)} span(s) have status=Error. "
            f"Your job is to explain THESE specific failures:\n{failing}\n\n"
            "Set verdict='failed' (or 'degraded' if the top-level request still "
            "returned). In probable_cause, explain what actually went wrong in "
            "these exact spans, referencing the service and error message. "
            "In evidence, quote the specific error text and span names. "
            "Do NOT say the trace looks healthy or within normal range."
        )
    else:
        slow_note = (
            f"The slowest span is {slowest['SpanName']} ({slowest['duration_ms']}ms)."
            if slowest else ""
        )
        focus = (
            "No span failed (all status=Unset/Ok). Set verdict='healthy', state "
            f"the request completed normally, and leave remediation empty. {slow_note}"
        )

    prompt = (
        f"Root-cause analysis for trace {trace_id}.\n"
        f"Total duration: {total}ms across {len(spans)} spans.\n\n"
        f"{focus}\n\n"
        f"ALL SPANS (in order):\n{span_lines}\n\n"
        f"CORRELATED LOGS:\n{log_lines}\n\n"
        "Respond as JSON. Make the analysis specific to this trace's evidence."
    )

    try:
        result = await ollama.run_in_ai_pool(
            ollama.generate_json, prompt, SYSTEM, RCA_SCHEMA
        )
    except ollama.OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    result["trace_id"] = trace_id
    result["span_count"] = len(spans)
    return result


@router.post("/summarize-incident")
async def summarize_incident(
    minutes: int = Query(60, ge=1, le=1440),
    service: str | None = Query(None),
    _user: User = Depends(get_current_user),
):
    _require_model()

    svc_clause = "AND ServiceName = {svc:String}" if service else ""
    params: dict = {"mins": minutes}
    if service:
        params["svc"] = service

    overview = _rows(
        ch_query(
            f"""
            SELECT count() AS requests,
                   countIf(StatusCode = 'Error') AS errors,
                   round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms
            FROM otel_traces
            WHERE ParentSpanId = ''
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE
              {svc_clause}
            """,
            params,
        )
    )
    services = _rows(
        ch_query(
            """
            SELECT ServiceName,
                   countIf(StatusCode = 'Error') AS errors,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms
            FROM otel_traces
            WHERE Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY ServiceName
            HAVING errors > 0
            ORDER BY errors DESC
            LIMIT 10
            """,
            {"mins": minutes},
        )
    )
    patterns = _rows(
        ch_query(
            f"""
            SELECT ServiceName,
                   replaceRegexpAll(Body, '[0-9]{{2,}}', 'N') AS pattern,
                   count() AS occurrences
            FROM otel_logs
            WHERE upper(SeverityText) = 'ERROR'
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE
              {svc_clause}
            GROUP BY ServiceName, pattern
            ORDER BY occurrences DESC
            LIMIT 10
            """,
            params,
        )
    )

    ov = overview[0] if overview else {}
    err_rate = ov.get("error_rate", 0) or 0
    svc_lines = "\n".join(
        f"- {s['ServiceName']}: {s['errors']} errors, p95 {s['p95_ms']}ms" for s in services
    ) or "(no failing services)"
    pat_lines = "\n".join(
        f"- {p['ServiceName']}: \"{p['pattern']}\" x{p['occurrences']}" for p in patterns
    ) or "(no error logs)"

    health_note = (
        "The system looks healthy: error rate is low and no service is failing."
        if err_rate < 2 and not services
        else f"Error rate is {err_rate}%."
    )

    prompt = (
        f"Summarise the state of this system over the last {minutes} minutes.\n\n"
        f"{health_note}\n"
        f"TOTALS: {ov.get('requests', 0)} requests, {ov.get('errors', 0)} errors "
        f"({err_rate}% error rate), p95 latency {ov.get('p95_ms', 0)}ms.\n\n"
        f"FAILING SERVICES:\n{svc_lines}\n\n"
        f"TOP ERROR MESSAGES:\n{pat_lines}\n\n"
        "If the system is healthy, set verdict='healthy' and say so plainly "
        "instead of inventing problems. Write an executive summary and a "
        "technical summary, list affected services (empty if none), and suggest "
        "next steps (empty if none needed). Respond as JSON."
    )

    try:
        result = await ollama.run_in_ai_pool(
            ollama.generate_json, prompt, SYSTEM, SUMMARY_SCHEMA
        )
    except ollama.OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    result["window_minutes"] = minutes
    result["stats"] = ov
    return result
