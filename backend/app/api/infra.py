"""Infrastructure metrics endpoints.

Host metrics from node-exporter, scraped into ClickHouse by the OTel
Collector. Gauges (memory, disk, load) use the latest sample; counters
(CPU, network) are differenced over the window to produce rates.
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
    """Headline host health plus load average."""
    mem = _rows(
        ch_query(
            """
            SELECT
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName='node_memory_MemAvailable_bytes'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS avail,
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName='node_memory_MemTotal_bytes'
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
                 WHERE MetricName='node_filesystem_avail_bytes'
                   AND Attributes['mountpoint']='/'
                   AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS avail,
                (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
                 WHERE MetricName='node_filesystem_size_bytes'
                   AND Attributes['mountpoint']='/'
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
                SELECT Attributes['mode'] AS mode, max(Value)-min(Value) AS delta
                FROM otel_metrics_sum
                WHERE MetricName='node_cpu_seconds_total'
                  AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
                GROUP BY mode
            )
            SELECT round((1 - sumIf(delta, mode='idle') / greatest(sum(delta),1)) * 100, 1)
            FROM deltas
            """,
            {"mins": minutes},
        )
    )

    load = _rows(
        ch_query(
            """
            SELECT
                (SELECT argMax(Value,TimeUnix) FROM otel_metrics_gauge WHERE MetricName='node_load1') AS l1,
                (SELECT argMax(Value,TimeUnix) FROM otel_metrics_gauge WHERE MetricName='node_load5') AS l5,
                (SELECT argMax(Value,TimeUnix) FROM otel_metrics_gauge WHERE MetricName='node_load15') AS l15
            """
        )
    )
    lr = load[0] if load else {}

    return {
        "cpu_pct": cpu,
        "memory_pct": mem_pct,
        "disk_pct": disk_pct,
        "memory_total_gb": round(total / 1e9, 1) if total else 0,
        "disk_total_gb": round(dsize / 1e9, 1) if dsize else 0,
        "load1": round(lr.get("l1", 0) or 0, 2),
        "load5": round(lr.get("l5", 0) or 0, 2),
        "load15": round(lr.get("l15", 0) or 0, 2),
    }


@router.get("/timeseries")
def infra_timeseries(minutes: int = Query(30, ge=1, le=1440)):
    """CPU busy %, memory %, and load, bucketed per minute."""
    mem_total = _scalar(
        ch_query(
            "SELECT argMax(Value,TimeUnix) FROM otel_metrics_gauge WHERE MetricName='node_memory_MemTotal_bytes'"
        ),
        default=1.0,
    )
    points = _rows(
        ch_query(
            f"""
            SELECT toStartOfMinute(TimeUnix) AS bucket,
                   round((1 - argMax(Value,TimeUnix)/{mem_total}) * 100, 1) AS memory_pct
            FROM otel_metrics_gauge
            WHERE MetricName='node_memory_MemAvailable_bytes'
              AND TimeUnix >= now() - INTERVAL {{mins:UInt32}} MINUTE
            GROUP BY bucket ORDER BY bucket
            """,
            {"mins": minutes},
        )
    )
    load = _rows(
        ch_query(
            """
            SELECT toStartOfMinute(TimeUnix) AS bucket,
                   round(argMax(Value,TimeUnix), 2) AS load1
            FROM otel_metrics_gauge
            WHERE MetricName='node_load1'
              AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY bucket ORDER BY bucket
            """,
            {"mins": minutes},
        )
    )
    load_map = {r["bucket"]: r["load1"] for r in load}
    for p in points:
        p["load1"] = load_map.get(p["bucket"], 0)
    return {"points": points}


@router.get("/network")
def infra_network(minutes: int = Query(30, ge=1, le=1440)):
    """Network RX/TX throughput (bytes/sec) on the primary interface, over time."""
    def series(metric: str, key: str):
        return _rows(
            ch_query(
                f"""
                SELECT bucket, round(greatest(max(Value)-min(Value),0)/60, 0) AS {key}
                FROM (
                    SELECT toStartOfMinute(TimeUnix) AS bucket, Value
                    FROM otel_metrics_sum
                    WHERE MetricName='{metric}' AND Attributes['device']='eth0'
                      AND TimeUnix >= now() - INTERVAL {{mins:UInt32}} MINUTE
                )
                GROUP BY bucket ORDER BY bucket
                """,
                {"mins": minutes},
            )
        )
    rx = series("node_network_receive_bytes_total", "rx_bps")
    tx = series("node_network_transmit_bytes_total", "tx_bps")
    tx_map = {r["bucket"]: r["tx_bps"] for r in tx}
    for r in rx:
        r["tx_bps"] = tx_map.get(r["bucket"], 0)
    return {"points": rx}


@router.get("/filesystems")
def infra_filesystems(minutes: int = Query(10, ge=1, le=1440)):
    """Per-mount filesystem usage."""
    rows = _rows(
        ch_query(
            """
            SELECT Attributes['mountpoint'] AS mount,
                   round(argMax(sz.Value,sz.TimeUnix)/1e9, 1) AS size_gb,
                   round((1 - argMax(av.Value,av.TimeUnix)/argMax(sz.Value,sz.TimeUnix))*100, 1) AS used_pct
            FROM otel_metrics_gauge AS av
            INNER JOIN otel_metrics_gauge AS sz
              ON av.Attributes['mountpoint']=sz.Attributes['mountpoint']
            WHERE av.MetricName='node_filesystem_avail_bytes'
              AND sz.MetricName='node_filesystem_size_bytes'
              AND av.Attributes['mountpoint'] != ''
              AND av.TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE
            GROUP BY mount ORDER BY size_gb DESC LIMIT 15
            """,
            {"mins": minutes},
        )
    )
    return {"filesystems": rows}


@router.get("/ai-summary")
async def infra_ai_summary(minutes: int = Query(10, ge=1, le=1440)):
    """Local-LLM assessment of current host health."""
    from app.services.ollama import run_in_ai_pool, generate_json

    s = infra_summary(minutes)
    fs = infra_filesystems(minutes)["filesystems"]
    fs_lines = "\n".join(f"- {f['mount']}: {f['used_pct']}% of {f['size_gb']}GB" for f in fs)

    prompt = (
        f"Assess this host's health from its live metrics. Be specific and brief.\n\n"
        f"CPU busy: {s['cpu_pct']}%\n"
        f"Memory used: {s['memory_pct']}% of {s['memory_total_gb']}GB\n"
        f"Disk used: {s['disk_pct']}% of {s['disk_total_gb']}GB\n"
        f"Load average (1/5/15m): {s['load1']} / {s['load5']} / {s['load15']}\n"
        f"Filesystems:\n{fs_lines}\n\n"
        "Rules: this is a 6-CPU host, so load under 6 is healthy. "
        "Flag anything genuinely concerning (disk >85%, memory >90%, load >6, "
        "rising trend). If everything is healthy, say so plainly in one line. "
        "Respond as JSON with fields: verdict (healthy/watch/critical), "
        "headline (one sentence), details (array of short strings)."
    )
    schema = {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["healthy", "watch", "critical"]},
            "headline": {"type": "string"},
            "details": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["verdict", "headline", "details"],
    }
    system = (
        "You are a site reliability engineer assessing host health from live "
        "metrics. Base every statement on the numbers given. Do not invent "
        "problems; if the host is healthy, say so plainly."
    )
    result = await run_in_ai_pool(generate_json, prompt, system, schema)
    return result
