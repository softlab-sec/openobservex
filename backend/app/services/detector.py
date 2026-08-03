"""Statistical anomaly detector.

An asyncio loop wakes every DETECT_INTERVAL seconds and, for each organization
and each (service, metric) pair, compares a short "current" window against a
longer rolling "baseline" window pulled from ClickHouse. When the current value
deviates beyond Z_DETECT standard deviations from the baseline mean, it is an
anomaly.

Lifecycle & dedup:
  - anomalies are keyed by (organization, service, metric)
  - while a deviation persists, the existing ACTIVE row is updated in place
    (occurrences++, consecutive_hits++, last_seen, refreshed observed/z_score)
  - when the metric returns under the (lower) clear threshold, the row is marked
    resolved after a short cooldown

Promotion hysteresis:
  - an anomaly is not promoted to an incident on the first hit
  - it must be sustained (consecutive_hits >= PROMOTE_AFTER) before an incident
    is auto-created, and it must clear the LOWER threshold to resolve (asymmetric
    thresholds prevent flapping)
"""

import logging
import statistics
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.clickhouse import ch_query_scoped
from app.core.tenant import TenantContext, set_tenant_context, get_tenant_context
from app.db.postgres import SessionLocal
from app.models import Anomaly, Incident, Organization
from app.api.applications import owned_tags

logger = logging.getLogger(__name__)

DETECT_INTERVAL = 60            # seconds between detector cycles
BASELINE_MINUTES = 60          # trailing window that defines "normal"
CURRENT_MINUTES = 5            # recent window we test against the baseline
BASELINE_BUCKET_MIN = 5        # baseline is bucketed into 5-min points for mean/std
Z_DETECT = 3.0                 # fire when |z| exceeds this
Z_CLEAR = 1.5                  # resolve only when |z| falls below this (hysteresis)
MIN_BASELINE_POINTS = 6        # need at least this many baseline buckets to judge
PROMOTE_AFTER = 3              # consecutive hits before promoting to an incident
RESOLVE_AFTER_CLEAR = 2        # consecutive clear cycles before marking resolved

METRICS = ("error_rate", "p95_latency")


def _severity_for(z: float) -> str:
    if z >= 6:
        return "critical"
    if z >= 4:
        return "warning"
    return "info"


def _baseline_and_current(metric: str, service: str) -> tuple[list[float], float] | None:
    """Return (baseline_bucket_values, current_value) for one service+metric,
    scoped to the current tenant context. None if insufficient data."""
    params = {
        "svc": service,
        "base_min": BASELINE_MINUTES,
        "cur_min": CURRENT_MINUTES,
        "bucket": BASELINE_BUCKET_MIN,
    }

    if metric == "error_rate":
        base_q = """
            SELECT toStartOfInterval(Timestamp, INTERVAL {bucket:UInt32} MINUTE) AS b,
                   round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 3) AS v
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {base_min:UInt32} MINUTE
              AND Timestamp <  now() - INTERVAL {cur_min:UInt32} MINUTE
              AND {tenant_scope}
            GROUP BY b ORDER BY b
        """
        cur_q = """
            SELECT round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 3) AS v
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {cur_min:UInt32} MINUTE
              AND {tenant_scope}
        """
    else:  # p95_latency
        base_q = """
            SELECT toStartOfInterval(Timestamp, INTERVAL {bucket:UInt32} MINUTE) AS b,
                   round(quantile(0.95)(Duration) / 1000000, 3) AS v
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {base_min:UInt32} MINUTE
              AND Timestamp <  now() - INTERVAL {cur_min:UInt32} MINUTE
              AND {tenant_scope}
            GROUP BY b ORDER BY b
        """
        cur_q = """
            SELECT round(quantile(0.95)(Duration) / 1000000, 3) AS v
            FROM otel_traces
            WHERE ServiceName = {svc:String}
              AND Timestamp >= now() - INTERVAL {cur_min:UInt32} MINUTE
              AND {tenant_scope}
        """

    base_rows = ch_query_scoped(base_q, params).result_rows
    baseline = [float(r[1]) for r in base_rows if r[1] is not None]
    if len(baseline) < MIN_BASELINE_POINTS:
        return None

    cur_rows = ch_query_scoped(cur_q, params).result_rows
    if not cur_rows or cur_rows[0][0] is None:
        return None
    current = float(cur_rows[0][0])
    return baseline, current


def _services_with_traffic() -> list[str]:
    """Distinct services that produced spans in the baseline window (tenant-scoped)."""
    q = """
        SELECT ServiceName, count() AS n
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {base_min:UInt32} MINUTE
          AND {tenant_scope}
        GROUP BY ServiceName
        HAVING n > 0
        ORDER BY n DESC
        LIMIT 50
    """
    rows = ch_query_scoped(q, {"base_min": BASELINE_MINUTES}).result_rows
    return [r[0] for r in rows if r[0]]


def _z_score(baseline: list[float], current: float) -> tuple[float, float, float]:
    mean = statistics.fmean(baseline)
    std = statistics.pstdev(baseline)
    if std < 1e-9:
        z = 0.0 if abs(current - mean) < 1e-9 else (10.0 if current > mean else -10.0)
    else:
        z = (current - mean) / std
    return z, mean, std


def _promote_to_incident(db, org_id, anomaly: Anomaly) -> None:
    """Create an incident from a sustained anomaly and link it back."""
    metric_label = "error rate" if anomaly.metric == "error_rate" else "p95 latency"
    unit = "%" if anomaly.metric == "error_rate" else "ms"
    summary = (
        f"anomalous {metric_label} on {anomaly.service}: "
        f"{anomaly.observed}{unit} vs baseline {round(anomaly.baseline_mean, 2)}{unit} "
        f"(z={round(anomaly.z_score, 1)})"
    )
    inc = Incident(
        organization_id=org_id,
        rule_id=None,
        rule_name=f"Anomaly: {metric_label} on {anomaly.service}",
        kind="anomaly",
        service=anomaly.service,
        severity=anomaly.severity,
        status="firing",
        observed_value=anomaly.observed,
        threshold=round(anomaly.baseline_mean, 3),
        summary=summary,
        started_at=datetime.now(timezone.utc),
    )
    db.add(inc)
    db.flush()
    anomaly.promoted_incident_id = inc.id
    logger.info("promoted anomaly %s -> incident %s", anomaly.id, inc.id)


def _process(db, org_id, service: str, metric: str) -> None:
    res = _baseline_and_current(metric, service)
    if res is None:
        return
    baseline, current = res
    z, mean, std = _z_score(baseline, current)

    existing = db.scalar(
        select(Anomaly).where(
            Anomaly.organization_id == org_id,
            Anomaly.service == service,
            Anomaly.metric == metric,
            Anomaly.status == "active",
        )
    )

    # both metrics are 'bad when high' — only flag positive deviations
    is_anomalous = z >= Z_DETECT
    now = datetime.now(timezone.utc)

    if is_anomalous:
        if existing:
            existing.observed = current
            existing.baseline_mean = mean
            existing.baseline_std = std
            existing.z_score = z
            existing.severity = _severity_for(z)
            existing.occurrences += 1
            existing.consecutive_hits += 1
            existing.last_seen = now
            if existing.consecutive_hits >= PROMOTE_AFTER and existing.promoted_incident_id is None:
                _promote_to_incident(db, org_id, existing)
        else:
            db.add(Anomaly(
                organization_id=org_id,
                service=service,
                metric=metric,
                observed=current,
                baseline_mean=mean,
                baseline_std=std,
                z_score=z,
                severity=_severity_for(z),
                status="active",
                occurrences=1,
                consecutive_hits=1,
                first_seen=now,
                last_seen=now,
            ))
    else:
        if existing:
            if z < Z_CLEAR:
                existing.last_seen = now
                if existing.consecutive_hits > 0:
                    existing.consecutive_hits = -1
                else:
                    existing.consecutive_hits -= 1
                if existing.consecutive_hits <= -RESOLVE_AFTER_CLEAR:
                    existing.status = "resolved"
                    existing.resolved_at = now
                    if existing.promoted_incident_id:
                        inc = db.get(Incident, existing.promoted_incident_id)
                        if inc and inc.status == "firing":
                            inc.status = "resolved"
                            inc.resolved_at = now
            # between Z_CLEAR and Z_DETECT: hold steady (grey zone), neither grow nor resolve


def detect_once() -> int:
    """Run one detection cycle across all orgs. Returns pairs checked."""
    checked = 0
    with SessionLocal() as db:
        orgs = db.scalars(select(Organization)).all()
        for org in orgs:
            tags = owned_tags(db, org.id)
            if not tags:
                continue
            set_tenant_context(TenantContext(org_id=str(org.id), owned_tags=tags))
            services = _services_with_traffic()
            for svc in services:
                for metric in METRICS:
                    checked += 1
                    try:
                        _process(db, org.id, svc, metric)
                    except Exception:  # noqa: BLE001
                        logger.exception("anomaly check failed for %s/%s", svc, metric)
        db.commit()
    return checked


async def detector_loop() -> None:
    import asyncio
    logger.info("anomaly detector started (interval %ds)", DETECT_INTERVAL)
    while True:
        try:
            n = await asyncio.to_thread(detect_once)
            logger.debug("anomaly detector checked %d pairs", n)
        except Exception:  # noqa: BLE001
            logger.exception("detector cycle failed")
        await asyncio.sleep(DETECT_INTERVAL)
