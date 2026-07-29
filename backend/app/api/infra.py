"""Infrastructure metrics endpoints.

Reads host (node-exporter) and container (cAdvisor) metrics that the OTel
Collector scrapes into ClickHouse. Gauges (memory, disk, container memory)
use the latest sample; counters (CPU, network) become rates by differencing
over the window.
"""

from fastapi import APIRouter, Depends, Query

from app.api.auth import get_current_user
from app.db.clickhouse import ch_query

router = APIRouter(
    prefix="/api/v1/infra",
    tags=["infra"],
    dependencies=[Depends(get_current_user)],
)


def _rows(result) -> list[dict]:
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


def _scalar(result, default=0.0) -> float:
    rows = result.result_rows
    if rows and rows[0] and rows[0][0] is not None:
        return float(rows[0][0])
    return default


@router.get("/summary")
def infra_summary(minutes: int = Query(10, ge=1, le=1440)):
    """Headline host health: CPU busy %, memory %, disk %."""
    mem = _rows(
        ch_query(
            """
            SELECT
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName = 'node_memory_MemAvailable_bytes'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS avail,
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName = 'node_memory_MemTotal_bytes'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS total
            """,
            {"mins": minutes},
        )
    )
    avail = mem[0]["avail"] if mem else 0
    total = mem[0]["total"] if mem else 0
    mem_pct = round((1 - avail / total) * 100, 1) if total else 0.0

    disk = _rows(
        ch_query(
            """
            SELECT
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName = 'node_filesystem_avail_bytes'
                   AND Attributes['mountpoint'] = '/'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS avail,
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName = 'node_filesystem_size_bytes'
                   AND Attributes['mountpoint'] = '/'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS size
            """,
            {"mins": minutes},
        )
    )
    davail = disk[0]["avail"] if disk else 0
    dsize = disk[0]["size"] if disk else 0
    disk_pct = round((1 - davail / dsize) * 100, 1) if dsize else 0.0

    cpu = _scalar(
        ch_query(
            """
            WITH deltas AS (
                SELECT Attributes['mode'] AS mode,
                       max(Value) - min(Value) AS delta
                FROM otel_metrics_sum
                WHERE MetricName = 'node_cpu_seconds_total'
                  AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
                GROUP BY mode
            )
            SELECT round((1 - sumIf(delta, mode = 'idle') / greatest(sum(delta), 1)) * 100, 1)
            FROM deltas
            """,
            {"mins": minutes},
        )
    )

    return {
        "cpu_busy_pct": cpu,
        "memory_used_pct": mem_pct,
        "disk_used_pct": disk_pct,
        "memory_total_gb": round(total / 1e9, 1) if total else 0,
        "disk_total_gb": round(dsize / 1e9, 1) if dsize else 0,
    }


@router.get("/timeseries")
def infra_timeseries(minutes: int = Query(30, ge=1, le=1440)):
    """Host memory-used % over time, bucketed per minute."""
    mem = _rows(
        ch_query(
            """
            SELECT toStartOfMinute(TimeUnix) AS bucket,
                   round((1 - argMax(Value, TimeUnix) /
                     (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                      WHERE MetricName='node_memory_MemTotal_bytes')) * 100, 1) AS mem_pct
            FROM otel_metrics_gauge
            WHERE MetricName = 'node_memory_MemAvailable_bytes'
              AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY bucket ORDER BY bucket
            """,
            {"mins": minutes},
        )
    )
    return {"points": mem}


@router.get("/containers")
def infra_containers(minutes: int = Query(10, ge=1, le=1440)):
    """Per-container memory usage from cAdvisor."""
    mem = _rows(
        ch_query(
            """
            SELECT Attributes['name'] AS container,
                   round(argMax(Value, TimeUnix) / 1e6, 1) AS mem_mb
            FROM otel_metrics_gauge
            WHERE MetricName = 'container_memory_usage_bytes'
              AND Attributes['name'] != ''
              AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY container ORDER BY mem_mb DESC LIMIT 30
            """,
            {"mins": minutes},
        )
    )
    return {"containers": mem}
