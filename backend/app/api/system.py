"""System self-observability endpoints.

OpenObserveX observing its own health. This is an operator-level view of
the platform itself (ingest freshness, query latency, storage growth,
component liveness), NOT tenant-scoped telemetry. Uses the raw ch_query
like infra does, behind auth. If any probe fails it is reported as
degraded rather than raising, so this page stays up even when a
dependency is down.
"""
import time
import socket
from urllib.request import urlopen
from urllib.error import URLError

from fastapi import APIRouter, Depends
from app.api.auth import get_current_user
from app.db.clickhouse import ch_query
from app.db.postgres import SessionLocal
from sqlalchemy import text

router = APIRouter(
    prefix="/api/v1/system",
    tags=["system"],
    dependencies=[Depends(get_current_user)],
)


def _scalar(result, default=0.0) -> float:
    rows = result.result_rows
    if rows and rows[0] and rows[0][0] is not None:
        return float(rows[0][0])
    return default


def _probe_tcp(host: str, port: int, timeout: float = 1.5) -> bool:
    """True if a TCP connection to host:port succeeds."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_http(url: str, timeout: float = 1.5) -> bool:
    """True if an HTTP GET returns any response (even an error status)."""
    try:
        urlopen(url, timeout=timeout)
        return True
    except URLError:
        return False
    except Exception:
        return False


@router.get("/health")
def system_health():
    """OpenObserveX's own operational vitals.

    Returns ingest freshness, self-query latency, storage growth, and
    component liveness. Every section is fault-tolerant: a failure in one
    probe is reported as degraded, never raised, so the health view
    survives a partial outage.
    """
    out: dict = {"generated_at": int(time.time())}

    # ---- Self query latency: time a trivial ClickHouse round-trip ----
    try:
        t0 = time.perf_counter()
        ch_query("SELECT 1")
        out["clickhouse_query_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        out["clickhouse_up"] = True
    except Exception as exc:
        out["clickhouse_query_ms"] = None
        out["clickhouse_up"] = False
        out["clickhouse_error"] = str(exc)[:200]

    # ---- Ingest freshness: seconds since the newest span landed ----
    # If this climbs, ingestion is stalling. dateDiff from the max
    # Timestamp to now, in seconds.
    try:
        lag = _scalar(
            ch_query(
                "SELECT dateDiff('second', max(Timestamp), now()) "
                "FROM otel_traces WHERE Timestamp > now() - INTERVAL 1 HOUR"
            ),
            default=-1.0,
        )
        # -1 means no rows in the last hour (nothing landing = stale)
        out["ingest_lag_seconds"] = None if lag < 0 else round(lag, 1)
    except Exception:
        out["ingest_lag_seconds"] = None

    # ---- Storage vitals: row counts + last-5-min ingest rate per signal ----
    # (table, timestamp column) per signal. Metrics use TimeUnix, not Timestamp.
    signals = {
        "traces": ("otel_traces", "Timestamp"),
        "logs": ("otel_logs", "Timestamp"),
        "metrics": ("otel_metrics_gauge", "TimeUnix"),
    }
    storage = {}
    for label, (table, ts_col) in signals.items():
        entry = {"rows": None, "per_min_5m": None}
        try:
            entry["rows"] = int(_scalar(ch_query(f"SELECT count() FROM {table}")))
        except Exception:
            pass
        try:
            # rows in the last 5 minutes, divided to a per-minute rate
            recent = _scalar(
                ch_query(
                    f"SELECT count() FROM {table} "
                    f"WHERE {ts_col} > now() - INTERVAL 5 MINUTE"
                )
            )
            entry["per_min_5m"] = round(recent / 5.0, 1)
        except Exception:
            pass
        storage[label] = entry
    out["storage"] = storage

    # ---- Postgres liveness: trivial round-trip ----
    try:
        t0 = time.perf_counter()
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
        out["postgres_query_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        out["postgres_up"] = True
    except Exception as exc:
        out["postgres_query_ms"] = None
        out["postgres_up"] = False
        out["postgres_error"] = str(exc)[:200]

    # ---- Component liveness: reachability of the supporting services ----
    # Hostnames are the docker-compose service names on the oox network.
    out["components"] = {
        "clickhouse": bool(out.get("clickhouse_up")),
        "postgres": bool(out.get("postgres_up")),
        "ingest_gateway": _probe_http("http://ingest-gateway:8100/health")
        or _probe_tcp("ingest-gateway", 8100),
        "ollama": _probe_http("http://ollama:11434/api/tags"),
    }

    # ---- Overall status: healthy / degraded / down ----
    core_up = out.get("clickhouse_up") and out.get("postgres_up")
    all_components = all(out["components"].values())
    if not core_up:
        out["status"] = "down"
    elif not all_components:
        out["status"] = "degraded"
    else:
        out["status"] = "healthy"

    return out
