"""Telemetry query endpoints backed by ClickHouse."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import get_current_user

from app.db.clickhouse import ch_query

router = APIRouter(
    prefix="/api/v1",
    tags=["telemetry"],
    dependencies=[Depends(get_current_user)],
)


def _rows(result) -> list[dict]:
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def _trace_filters(
    minutes: int,
    service: Optional[str],
    errors_only: bool,
    root_only: bool = True,
) -> tuple[str, dict]:
    """Build a shared WHERE clause so every widget honours the same filters."""
    clauses = ["Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE"]
    params: dict = {"mins": minutes}
    if root_only:
        clauses.append("ParentSpanId = ''")
    if service:
        clauses.append("ServiceName = {svc:String}")
        params["svc"] = service
    if errors_only:
        clauses.append("StatusCode = 'Error'")
    return " AND ".join(clauses), params


# --------------------------------------------------------------------------
# Stats / aggregations
# --------------------------------------------------------------------------


@router.get("/stats/overview")
def stats_overview(
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    where, params = _trace_filters(minutes, service, errors_only)
    query = f"""
        SELECT
            count()                                                  AS requests,
            countIf(StatusCode = 'Error')                            AS errors,
            round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
            round(quantile(0.50)(Duration) / 1000000, 2)             AS p50_ms,
            round(quantile(0.95)(Duration) / 1000000, 2)             AS p95_ms,
            round(quantile(0.99)(Duration) / 1000000, 2)             AS p99_ms,
            uniqExact(TraceId)                                       AS traces
        FROM otel_traces
        WHERE {where}
    """
    data = _rows(ch_query(query, params))
    return data[0] if data else {}


@router.get("/stats/timeseries")
def stats_timeseries(
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    where, params = _trace_filters(minutes, service, errors_only)
    query = f"""
        SELECT
            toStartOfMinute(Timestamp)                    AS bucket,
            count()                                       AS requests,
            countIf(StatusCode = 'Error')                 AS errors,
            round(quantile(0.50)(Duration) / 1000000, 2)  AS p50_ms,
            round(quantile(0.95)(Duration) / 1000000, 2)  AS p95_ms,
            round(quantile(0.99)(Duration) / 1000000, 2)  AS p99_ms
        FROM otel_traces
        WHERE {where}
        GROUP BY bucket
        ORDER BY bucket ASC
    """
    return {"points": _rows(ch_query(query, params))}


@router.get("/stats/services")
def stats_services(
    minutes: int = Query(60, ge=1, le=10080),
    errors_only: bool = Query(False),
):
    where, params = _trace_filters(minutes, None, errors_only, root_only=False)
    query = f"""
        SELECT
            ServiceName,
            count()                                                     AS spans,
            countIf(StatusCode = 'Error')                               AS errors,
            round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
            round(avg(Duration) / 1000000, 2)                           AS avg_ms,
            round(quantile(0.95)(Duration) / 1000000, 2)                AS p95_ms
        FROM otel_traces
        WHERE {where}
        GROUP BY ServiceName
        ORDER BY spans DESC
    """
    return {"services": _rows(ch_query(query, params))}


@router.get("/stats/endpoints")
def stats_endpoints(
    minutes: int = Query(60, ge=1, le=10080),
    limit: int = Query(10, ge=1, le=50),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    where, params = _trace_filters(minutes, service, errors_only)
    params["lim"] = limit
    query = f"""
        SELECT
            SpanName                                                    AS endpoint,
            any(ServiceName)                                            AS service,
            count()                                                     AS requests,
            countIf(StatusCode = 'Error')                               AS errors,
            round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
            round(quantile(0.50)(Duration) / 1000000, 2)                AS p50_ms,
            round(quantile(0.95)(Duration) / 1000000, 2)                AS p95_ms,
            round(quantile(0.99)(Duration) / 1000000, 2)                AS p99_ms
        FROM otel_traces
        WHERE {where}
        GROUP BY endpoint
        ORDER BY requests DESC
        LIMIT {{lim:UInt32}}
    """
    return {"endpoints": _rows(ch_query(query, params))}


@router.get("/stats/latency-samples")
def stats_latency_samples(
    minutes: int = Query(60, ge=1, le=10080),
    limit: int = Query(400, ge=10, le=2000),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    """Individual request latencies for a scatter plot."""
    where, params = _trace_filters(minutes, service, errors_only)
    params["lim"] = limit
    query = f"""
        SELECT
            toUnixTimestamp64Milli(Timestamp)  AS ts,
            round(Duration / 1000000, 2)       AS ms,
            SpanName                           AS endpoint,
            StatusCode                         AS status,
            TraceId                            AS trace_id
        FROM otel_traces
        WHERE {where}
        ORDER BY Timestamp DESC
        LIMIT {{lim:UInt32}}
    """
    return {"samples": _rows(ch_query(query, params))}


@router.get("/stats/latency-distribution")
def stats_latency_distribution(
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    """Request counts bucketed by duration, for a histogram."""
    where, params = _trace_filters(minutes, service, errors_only)
    query = f"""
        SELECT bucket, sortOrder, count() AS requests,
               countIf(StatusCode = 'Error') AS errors
        FROM (
            SELECT
                multiIf(
                    Duration <  25000000, '0-25ms',
                    Duration <  50000000, '25-50ms',
                    Duration < 100000000, '50-100ms',
                    Duration < 200000000, '100-200ms',
                    Duration < 500000000, '200-500ms',
                                          '500ms+') AS bucket,
                multiIf(
                    Duration <  25000000, 1,
                    Duration <  50000000, 2,
                    Duration < 100000000, 3,
                    Duration < 200000000, 4,
                    Duration < 500000000, 5, 6)      AS sortOrder,
                StatusCode
            FROM otel_traces
            WHERE {where}
        )
        GROUP BY bucket, sortOrder
        ORDER BY sortOrder ASC
    """
    return {"buckets": _rows(ch_query(query, params))}


@router.get("/stats/error-share")
def stats_error_share(
    minutes: int = Query(60, ge=1, le=10080),
):
    """Error counts per service, for a donut chart."""
    query = """
        SELECT ServiceName AS service, countIf(StatusCode = 'Error') AS errors
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
        GROUP BY service
        HAVING errors > 0
        ORDER BY errors DESC
    """
    return {"share": _rows(ch_query(query, {"mins": minutes}))}


@router.get("/stats/service-map")
def stats_service_map(minutes: int = Query(60, ge=1, le=10080)):
    """Directed service dependency edges derived from parent/child spans."""
    query = """
        SELECT
            p.ServiceName                       AS source,
            c.ServiceName                       AS target,
            count()                             AS calls,
            countIf(c.StatusCode = 'Error')     AS errors,
            round(avg(c.Duration) / 1000000, 2) AS avg_ms
        FROM otel_traces AS c
        INNER JOIN otel_traces AS p
          ON c.ParentSpanId = p.SpanId AND c.TraceId = p.TraceId
        WHERE c.ParentSpanId != ''
          AND c.Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
        GROUP BY source, target
        HAVING source != target
        ORDER BY calls DESC
        LIMIT 100
    """
    edges = _rows(ch_query(query, {"mins": minutes}))
    nodes = sorted({e["source"] for e in edges} | {e["target"] for e in edges})
    return {"nodes": nodes, "edges": edges}


@router.get("/stats/error-patterns")
def stats_error_patterns(
    minutes: int = Query(60, ge=1, le=10080),
    limit: int = Query(10, ge=1, le=50),
    service: Optional[str] = Query(None),
):
    clauses = [
        "upper(SeverityText) = 'ERROR'",
        "Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE",
    ]
    params: dict = {"mins": minutes, "lim": limit}
    if service:
        clauses.append("ServiceName = {svc:String}")
        params["svc"] = service
    where = " AND ".join(clauses)
    query = f"""
        SELECT
            ServiceName                              AS service,
            replaceRegexpAll(Body, '[0-9]{{2,}}', 'N') AS pattern,
            count()                                  AS occurrences,
            max(Timestamp)                           AS last_seen
        FROM otel_logs
        WHERE {where}
        GROUP BY service, pattern
        ORDER BY occurrences DESC
        LIMIT {{lim:UInt32}}
    """
    return {"patterns": _rows(ch_query(query, params))}


# --------------------------------------------------------------------------
# Traces
# --------------------------------------------------------------------------


@router.get("/traces")
def list_traces(
    limit: int = Query(50, ge=1, le=500),
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
    errors_only: bool = Query(False),
):
    where, params = _trace_filters(minutes, service, errors_only)
    params["lim"] = limit
    query = f"""
        SELECT
            r.TraceId                       AS TraceId,
            r.Timestamp                     AS Timestamp,
            r.ServiceName                   AS ServiceName,
            r.SpanName                      AS SpanName,
            r.Duration                      AS Duration,
            round(r.Duration / 1000000, 2)  AS duration_ms,
            r.StatusCode                    AS StatusCode,
            c.span_count                    AS span_count
        FROM (
            SELECT TraceId, Timestamp, ServiceName, SpanName, Duration, StatusCode
            FROM otel_traces
            WHERE {where}
            ORDER BY Timestamp DESC
            LIMIT {{lim:UInt32}}
        ) AS r
        LEFT JOIN (
            SELECT TraceId, count() AS span_count
            FROM otel_traces
            WHERE Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE
            GROUP BY TraceId
        ) AS c ON r.TraceId = c.TraceId
        ORDER BY Timestamp DESC
    """
    items = _rows(ch_query(query, params))
    return {"count": len(items), "items": items}


@router.get("/traces/{trace_id}")
def get_trace(trace_id: str):
    if not trace_id.isalnum() or len(trace_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid trace id")
    query = """
        WITH (SELECT min(Timestamp) FROM otel_traces WHERE TraceId = {tid:String}) AS t0
        SELECT
            SpanId, ParentSpanId, ServiceName, SpanName, SpanKind,
            StatusCode, StatusMessage,
            round(Duration / 1000000, 3)                             AS duration_ms,
            round(dateDiff('microsecond', t0, Timestamp) / 1000, 3)  AS offset_ms,
            SpanAttributes
        FROM otel_traces
        WHERE TraceId = {tid:String}
        ORDER BY Timestamp ASC
    """
    spans = _rows(ch_query(query, {"tid": trace_id}))
    if not spans:
        raise HTTPException(status_code=404, detail="Trace not found")
    total = max((s["offset_ms"] + s["duration_ms"]) for s in spans)
    return {"trace_id": trace_id, "span_count": len(spans), "total_ms": total, "spans": spans}


@router.get("/spans")
def list_spans(
    limit: int = Query(50, ge=1, le=1000),
    service: Optional[str] = Query(None),
):
    where = ""
    params: dict = {"lim": limit}
    if service:
        where = "WHERE ServiceName = {svc:String}"
        params["svc"] = service
    query = f"""
        SELECT Timestamp, TraceId, SpanId, ParentSpanId,
               ServiceName, SpanName, Duration, StatusCode
        FROM otel_traces
        {where}
        ORDER BY Timestamp DESC
        LIMIT {{lim:UInt32}}
    """
    items = _rows(ch_query(query, params))
    return {"count": len(items), "items": items}


# --------------------------------------------------------------------------
# Logs
# --------------------------------------------------------------------------


@router.get("/logs")
def list_logs(
    limit: int = Query(50, ge=1, le=1000),
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, description="Comma separated, e.g. ERROR,WARN"),
    search: Optional[str] = Query(None, description="Case-insensitive text match on body"),
):
    filters = ["Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE"]
    params: dict = {"mins": minutes, "lim": limit}
    if service:
        filters.append("ServiceName = {svc:String}")
        params["svc"] = service
    if severity:
        levels = [s.strip().upper() for s in severity.split(",") if s.strip()]
        if levels:
            filters.append("upper(SeverityText) IN {sev:Array(String)}")
            params["sev"] = levels
    if search:
        filters.append("positionCaseInsensitive(Body, {q:String}) > 0")
        params["q"] = search
    where = " AND ".join(filters)
    query = f"""
        SELECT Timestamp, ServiceName, SeverityText, Body, TraceId, SpanId
        FROM otel_logs
        WHERE {where}
        ORDER BY Timestamp DESC
        LIMIT {{lim:UInt32}}
    """
    items = _rows(ch_query(query, params))
    return {"count": len(items), "items": items}


@router.get("/logs/severities")
def log_severities(
    minutes: int = Query(60, ge=1, le=10080),
    service: Optional[str] = Query(None),
):
    clauses = ["Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE"]
    params: dict = {"mins": minutes}
    if service:
        clauses.append("ServiceName = {svc:String}")
        params["svc"] = service
    query = f"""
        SELECT upper(SeverityText) AS severity, count() AS count
        FROM otel_logs
        WHERE {" AND ".join(clauses)}
        GROUP BY severity
        ORDER BY count DESC
    """
    return {"severities": _rows(ch_query(query, params))}


@router.get("/services")
def list_services():
    query = """
        SELECT DISTINCT ServiceName FROM (
            SELECT ServiceName FROM otel_logs
            UNION DISTINCT
            SELECT ServiceName FROM otel_traces
        )
        ORDER BY ServiceName
    """
    return {"services": [row[0] for row in ch_query(query).result_rows]}


# --------------------------------------------------------------------------
# Service drill-down + application grouping (service map support)
# --------------------------------------------------------------------------


@router.get("/applications")
def list_applications():
    """Distinct applications (OTel service.namespace) that have sent telemetry.

    Empty until real apps tag their telemetry; the simulator sends none, so
    the UI shows a single "All services" option today.
    """
    query = """
        SELECT DISTINCT ResourceAttributes['service.namespace'] AS app
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL 1440 MINUTE
          AND ResourceAttributes['service.namespace'] != ''
        ORDER BY app
    """
    apps = [row[0] for row in ch_query(query).result_rows]
    return {"applications": apps}


@router.get("/stats/service-detail")
def stats_service_detail(
    service: str = Query(..., min_length=1, max_length=128),
    minutes: int = Query(60, ge=1, le=10080),
):
    """Everything the drill-down panel needs for one service."""
    totals = _rows(
        ch_query(
            """
            SELECT count() AS spans,
                   countIf(StatusCode = 'Error') AS errors,
                   round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
                   round(quantile(0.50)(Duration) / 1000000, 2) AS p50_ms,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms,
                   round(quantile(0.99)(Duration) / 1000000, 2) AS p99_ms
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            """,
            {"svc": service, "mins": minutes},
        )
    )
    operations = _rows(
        ch_query(
            """
            SELECT SpanName AS operation, count() AS calls,
                   countIf(StatusCode = 'Error') AS errors,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY operation ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    upstream = _rows(
        ch_query(
            """
            SELECT p.ServiceName AS service, count() AS calls
            FROM otel_traces AS c
            INNER JOIN otel_traces AS p
              ON c.ParentSpanId = p.SpanId AND c.TraceId = p.TraceId
            WHERE c.ServiceName = {svc:String} AND p.ServiceName != {svc:String}
              AND c.Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY service ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    downstream = _rows(
        ch_query(
            """
            SELECT c.ServiceName AS service, count() AS calls,
                   countIf(c.StatusCode = 'Error') AS errors
            FROM otel_traces AS c
            INNER JOIN otel_traces AS p
              ON c.ParentSpanId = p.SpanId AND c.TraceId = p.TraceId
            WHERE p.ServiceName = {svc:String} AND c.ServiceName != {svc:String}
              AND c.Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY service ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    return {
        "service": service,
        "totals": totals[0] if totals else {},
        "operations": operations,
        "upstream": upstream,
        "downstream": downstream,
    }


# --------------------------------------------------------------------------
# Service drill-down + application grouping (service map support)
# --------------------------------------------------------------------------


@router.get("/applications")
def list_applications():
    query = """
        SELECT DISTINCT ResourceAttributes['service.namespace'] AS app
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL 1440 MINUTE
          AND ResourceAttributes['service.namespace'] != ''
        ORDER BY app
    """
    apps = [row[0] for row in ch_query(query).result_rows]
    return {"applications": apps}


@router.get("/stats/service-detail")
def stats_service_detail(
    service: str = Query(..., min_length=1, max_length=128),
    minutes: int = Query(60, ge=1, le=10080),
):
    totals = _rows(
        ch_query(
            """
            SELECT count() AS spans,
                   countIf(StatusCode = 'Error') AS errors,
                   round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS error_rate,
                   round(quantile(0.50)(Duration) / 1000000, 2) AS p50_ms,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms,
                   round(quantile(0.99)(Duration) / 1000000, 2) AS p99_ms
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            """,
            {"svc": service, "mins": minutes},
        )
    )
    operations = _rows(
        ch_query(
            """
            SELECT SpanName AS operation, count() AS calls,
                   countIf(StatusCode = 'Error') AS errors,
                   round(quantile(0.95)(Duration) / 1000000, 2) AS p95_ms
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY operation ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    upstream = _rows(
        ch_query(
            """
            SELECT p.ServiceName AS service, count() AS calls
            FROM otel_traces AS c
            INNER JOIN otel_traces AS p
              ON c.ParentSpanId = p.SpanId AND c.TraceId = p.TraceId
            WHERE c.ServiceName = {svc:String} AND p.ServiceName != {svc:String}
              AND c.Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY service ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    downstream = _rows(
        ch_query(
            """
            SELECT c.ServiceName AS service, count() AS calls,
                   countIf(c.StatusCode = 'Error') AS errors
            FROM otel_traces AS c
            INNER JOIN otel_traces AS p
              ON c.ParentSpanId = p.SpanId AND c.TraceId = p.TraceId
            WHERE p.ServiceName = {svc:String} AND c.ServiceName != {svc:String}
              AND c.Timestamp >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY service ORDER BY calls DESC LIMIT 8
            """,
            {"svc": service, "mins": minutes},
        )
    )
    return {
        "service": service,
        "totals": totals[0] if totals else {},
        "operations": operations,
        "upstream": upstream,
        "downstream": downstream,
    }
