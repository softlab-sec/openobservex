"""Alert rule evaluator.

A single asyncio loop wakes every EVAL_INTERVAL seconds, runs each enabled
rule's ClickHouse query over its sustained window, and manages incident
state so a rule fires ONCE when it starts breaching and RESOLVES when it
recovers, rather than notifying every cycle.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.clickhouse import ch_query
from app.db.postgres import SessionLocal
from app.models import AlertRule, Incident, MaintenanceWindow
from app.services import notifications

logger = logging.getLogger(__name__)

EVAL_INTERVAL = 60  # seconds


def _compare(value: float, operator: str, threshold: float) -> bool:
    """Apply the rule's comparison operator. Defaults to > for safety."""
    if operator == "<":
        return value < threshold
    if operator == ">=":
        return value >= threshold
    if operator == "<=":
        return value <= threshold
    if operator == "=":
        return value == threshold
    if operator == "!=":
        return value != threshold
    return value > threshold  # ">" and any unknown operator


def _infra_cpu_pct(mins: int) -> float | None:
    """Cluster CPU utilization percent over the window (same calc as infra page)."""
    rows = ch_query(
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
        {"mins": mins},
    ).result_rows
    return float(rows[0][0]) if rows and rows[0][0] is not None else None


def _infra_mem_pct(mins: int) -> float | None:
    """Memory used percent (same calc as infra page)."""
    rows = ch_query(
        """
        SELECT
            (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
             WHERE MetricName='node_memory_MemAvailable_bytes'
               AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS avail,
            (SELECT argMax(Value, TimeUnix) FROM otel_metrics_gauge
             WHERE MetricName='node_memory_MemTotal_bytes'
               AND TimeUnix >= now() - INTERVAL {mins:UInt32} MINUTE) AS total
        """,
        {"mins": mins},
    ).result_rows
    if not rows or not rows[0][1]:
        return None
    avail, total = rows[0]
    return round((1 - avail / total) * 100, 1)


def _infra_disk_pct(mins: int) -> float | None:
    """Root filesystem used percent (same calc as infra page)."""
    rows = ch_query(
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
        {"mins": mins},
    ).result_rows
    if not rows or not rows[0][1]:
        return None
    avail, size = rows[0]
    return round((1 - avail / size) * 100, 1)


_INFRA_FN = {"cpu": _infra_cpu_pct, "memory": _infra_mem_pct, "disk": _infra_disk_pct}
_INFRA_NAME = {"cpu": "CPU", "memory": "Memory", "disk": "Disk"}


def _evaluate_infra(rule: AlertRule) -> tuple[bool, float, str]:
    """Cluster-wide infra alert (cpu/memory/disk). Percentage vs threshold via
    the rule's operator. Not service-scoped — these are host metrics."""
    mins = rule.for_minutes
    fn = _INFRA_FN[rule.kind]
    pct = fn(mins)
    name = _INFRA_NAME[rule.kind]
    if pct is None:
        return (False, 0.0, f"{name} metric unavailable over {mins}m")
    breaching = _compare(pct, rule.operator, rule.threshold)
    return (breaching, pct,
            f"{name} usage {pct}% over {mins}m (threshold {rule.operator} {rule.threshold}%)")


def _evaluate_rule(rule: AlertRule) -> tuple[bool, float, str]:
    """Return (breaching, observed_value, human summary) for one rule."""
    mins = rule.for_minutes
    svc = rule.service
    svc_clause = "AND ServiceName = {svc:String}" if svc else ""
    params: dict = {"mins": mins}
    if svc:
        params["svc"] = svc

    if rule.kind in ("cpu", "memory", "disk"):
        return _evaluate_infra(rule)
    if rule.kind == "error_rate":
        q = f"""
            SELECT
                count() AS total,
                countIf(StatusCode = 'Error') AS errors,
                round(countIf(StatusCode = 'Error') / greatest(count(), 1) * 100, 2) AS pct
            FROM otel_traces
            WHERE ParentSpanId = ''
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
        """
        rows = ch_query(q, params).result_rows
        total, _errors, pct = (rows[0] if rows else (0, 0, 0.0))
        if total < rule.min_samples:
            return (False, float(pct or 0), f"only {total} samples (<{rule.min_samples})")
        breaching = _compare(float(pct or 0), rule.operator, rule.threshold)
        return (breaching, float(pct or 0),
                f"error rate {pct}% over {mins}m (threshold {rule.threshold}%)")

    if rule.kind == "latency":
        pctl = 0.99 if rule.percentile == 99 else 0.95
        q = f"""
            SELECT count() AS total,
                   round(quantile({pctl})(Duration) / 1000000, 2) AS p
            FROM otel_traces
            WHERE ParentSpanId = ''
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
        """
        rows = ch_query(q, params).result_rows
        total, p = (rows[0] if rows else (0, 0.0))
        if total < rule.min_samples:
            return (False, float(p or 0), f"only {total} samples (<{rule.min_samples})")
        breaching = _compare(float(p or 0), rule.operator, rule.threshold)
        return (breaching, float(p or 0),
                f"p{rule.percentile} latency {p}ms over {mins}m (threshold {rule.threshold}ms)")

    if rule.kind == "log_spike":
        q = f"""
            SELECT count() AS errors
            FROM otel_logs
            WHERE upper(SeverityText) = 'ERROR'
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
        """
        rows = ch_query(q, params).result_rows
        errors = (rows[0][0] if rows else 0)
        breaching = _compare(float(errors or 0), rule.operator, rule.threshold)
        return (breaching, float(errors or 0),
                f"{errors} error logs over {mins}m (threshold {int(rule.threshold)})")

    if rule.kind == "service_down":
        q = f"""
            SELECT count() AS total
            FROM otel_traces
            WHERE Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
        """
        rows = ch_query(q, params).result_rows
        total = (rows[0][0] if rows else 0)
        breaching = (total or 0) == 0
        return (breaching, float(total or 0),
                f"{total} spans over {mins}m for {svc or 'all services'} (expected >0)")

    return (False, 0.0, f"unknown rule kind: {rule.kind}")



# Human-readable label + unit per alert kind, for professional notifications.
_KIND_LABEL = {
    "error_rate": "Error rate",
    "latency": "Latency",
    "throughput": "Throughput",
    "service_down": "Availability",
    "cpu": "CPU",
    "memory": "Memory",
    "disk": "Disk",
    "network": "Network",
}
_KIND_UNIT = {
    "error_rate": "%",
    "latency": "ms",
    "throughput": " req/s",
    "cpu": "%",
    "memory": "%",
    "disk": "%",
}
_SEV_LABEL = {"critical": "Critical", "high": "High", "warning": "Warning", "info": "Info"}


def _fmt_val(rule: "AlertRule", value: float) -> str:
    unit = _KIND_UNIT.get(rule.kind, "")
    v = round(value, 2)
    v = int(v) if v == int(v) else v
    return f"{v}{unit}"


def _format_alert(rule: "AlertRule", value: float, status: str) -> tuple[str, str]:
    """Build a professional plain-text (subject, body) for a firing or
    resolved alert. status is 'firing' or 'resolved'."""
    sev = _SEV_LABEL.get((rule.severity or "warning").lower(), "Warning")
    label = _KIND_LABEL.get(rule.kind, rule.kind)
    service = rule.service or "All services"
    observed = _fmt_val(rule, value)
    threshold = _fmt_val(rule, rule.threshold)
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    on_svc = f" on {rule.service}" if rule.service else ""
    if status == "firing":
        subject = f"[{sev.upper()}] TRIGGERED: {rule.name}{on_svc}"
        body = (
            f"TRIGGERED: {rule.name}\n\n"
            f"Severity:    {sev}\n"
            f"Service:     {service}\n"
            f"Observed:    {observed}\n"
            f"Threshold:   {threshold}\n"
            f"Window:      {rule.for_minutes} minute(s)\n\n"
            f"Triggered:   {when}\n"
        )
    else:
        subject = f"[{sev.upper()}] RECOVERED: {rule.name}{on_svc}"
        body = (
            f"RECOVERED: {rule.name}\n\n"
            f"Severity:        {sev}\n"
            f"Service:         {service}\n"
            f"Current value:   {observed}\n"
            f"Recovery below:  {threshold}\n\n"
            f"Recovered:       {when}\n"
        )
    return subject, body


def _notify_channels(db, rule: AlertRule, subject: str, body: str) -> None:
    """Send to each NotificationChannel this rule selected. Never raises."""
    if not rule.channel_ids:
        return
    from app.models import NotificationChannel
    from app.services.dispatch import dispatch, parse_config

    ids = [c.strip() for c in rule.channel_ids.split(",") if c.strip()]
    for cid in ids:
        try:
            ch = db.get(NotificationChannel, cid)
            if ch and ch.enabled:
                dispatch(ch.kind, parse_config(ch.config), subject, body)
        except Exception:
            logger.exception("channel dispatch failed for %s", cid)


def _in_maintenance(db, rule: AlertRule) -> bool:
    """True if an active maintenance window covers this rule right now.

    A window covers the rule when it belongs to the same org, the current
    time is within [starts_at, ends_at], and the window is either org-wide
    (service IS NULL) or targets the rule's exact service.
    """
    now = datetime.now(timezone.utc)
    win = db.scalar(
        select(MaintenanceWindow).where(
            MaintenanceWindow.organization_id == rule.organization_id,
            MaintenanceWindow.starts_at <= now,
            MaintenanceWindow.ends_at >= now,
            (MaintenanceWindow.service.is_(None))
            | (MaintenanceWindow.service == rule.service),
        )
    )
    return win is not None


def _enrich_error_rate(rule: AlertRule, mins: int) -> dict | None:
    """One ClickHouse query for operator context on an error_rate/latency alert.

    Returns total requests, failed requests, affected-endpoint count, and the
    top failing endpoint over the rule's service and window. Best-effort:
    returns None on any failure so it can never affect the alert that already
    fired.
    """
    try:
        svc_clause = "AND ServiceName = {svc:String}" if rule.service else ""
        params: dict = {"mins": mins}
        if rule.service:
            params["svc"] = rule.service
        # Totals over root spans, matching how error_rate is evaluated.
        totals = ch_query(
            f"""
            SELECT count() AS total,
                   countIf(StatusCode = 'Error') AS failed,
                   uniqExactIf(SpanName, StatusCode = 'Error') AS bad_endpoints
            FROM otel_traces
            WHERE ParentSpanId = ''
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
            """,
            params,
        ).result_rows
        total, failed, bad_endpoints = (totals[0] if totals else (0, 0, 0))
        # Top failing endpoint by error count.
        top = ch_query(
            f"""
            SELECT SpanName AS endpoint,
                   countIf(StatusCode = 'Error') AS errors,
                   count() AS reqs
            FROM otel_traces
            WHERE ParentSpanId = ''
              AND Timestamp >= now() - INTERVAL {{mins:UInt32}} MINUTE {svc_clause}
            GROUP BY SpanName
            HAVING errors > 0
            ORDER BY errors DESC
            LIMIT 1
            """,
            params,
        ).result_rows
        top_endpoint = None
        if top:
            ep, errs, reqs = top[0]
            rate = round((errs / reqs * 100) if reqs else 0, 1)
            top_endpoint = {"name": ep, "errors": int(errs), "reqs": int(reqs), "rate": rate}
        return {
            "total": int(total or 0),
            "failed": int(failed or 0),
            "bad_endpoints": int(bad_endpoints or 0),
            "top_endpoint": top_endpoint,
        }
    except Exception:
        logger.exception("enrichment query failed for rule %s", rule.name)
        return None


def _enrich_lines(rule: AlertRule, mins: int) -> str:
    """Best-effort operator context appended to a firing notification.
    Returns an empty string if enrichment is unavailable, so no invented
    fields ever appear. Only meaningful for trace-based kinds."""
    if rule.kind not in ("error_rate", "latency"):
        return ""
    ctx = _enrich_error_rate(rule, mins)
    if not ctx or ctx["total"] == 0:
        return ""
    lines = ["", "Impact:"]
    lines.append(f"  Failed Requests:    {ctx['failed']:,} of {ctx['total']:,}")
    if ctx["bad_endpoints"]:
        lines.append(f"  Affected Endpoints: {ctx['bad_endpoints']}")
    te = ctx.get("top_endpoint")
    if te:
        lines.append(f"  Top Endpoint:       {te['name']} ({te['rate']}% errors, {te['errors']:,} of {te['reqs']:,})")
    return "\n".join(lines) + "\n"


def _fire(db, rule: AlertRule, value: float, summary: str) -> None:
    if _in_maintenance(db, rule):
        logger.info(
            "suppressing fire for rule %s (%s): active maintenance window",
            rule.name, rule.service or "org-wide",
        )
        return
    existing = db.scalar(
        select(Incident).where(
            Incident.rule_id == rule.id, Incident.status == "firing"
        )
    )
    if existing:
        return  # already firing; don't spam

    inc = Incident(
        organization_id=rule.organization_id,
        rule_id=rule.id,
        rule_name=rule.name,
        severity=rule.severity,
        kind=rule.kind,
        service=rule.service,
        status="firing",
        observed_value=value,
        threshold=rule.threshold,
        summary=summary,
    )
    db.add(inc)
    db.commit()

    from app.models import IncidentEvent
    db.add(IncidentEvent(incident_id=inc.id, kind="fired", actor=None, detail=summary))
    db.commit()

    _wh_subject, text = _format_alert(rule, value, "firing")
    _extra = _enrich_lines(rule, rule.for_minutes)
    if _extra:
        text = text + _extra
    payload = {
        "status": "firing",
        "rule": rule.name,
        "kind": rule.kind,
        "service": rule.service,
        "observed_value": value,
        "threshold": rule.threshold,
        "summary": summary,
    }
    if rule.webhook_urls:
        notifications.notify_all(rule.webhook_urls.split(","), text, payload)
    fire_subject, fire_body = _format_alert(rule, value, "firing")
    if _extra:
        fire_body = fire_body + _extra
    _notify_channels(db, rule, fire_subject, fire_body)
    logger.info("incident FIRING: %s (%s)", rule.name, summary)


def _resolve(db, rule: AlertRule, value: float) -> None:
    inc = db.scalar(
        select(Incident).where(
            Incident.rule_id == rule.id, Incident.status == "firing"
        )
    )
    if not inc:
        return

    inc.status = "resolved"
    inc.resolved_at = datetime.now(timezone.utc)
    db.commit()

    _wh_subject, text = _format_alert(rule, value, "resolved")
    payload = {
        "status": "resolved",
        "rule": rule.name,
        "kind": rule.kind,
        "service": rule.service,
        "observed_value": value,
    }
    if rule.webhook_urls:
        notifications.notify_all(rule.webhook_urls.split(","), text, payload)
    res_subject, res_body = _format_alert(rule, value, "resolved")
    _notify_channels(db, rule, res_subject, res_body)
    logger.info("incident RESOLVED: %s", rule.name)


def evaluate_once() -> int:
    """Run all enabled rules once. Returns how many were checked."""
    checked = 0
    with SessionLocal() as db:
        rules = db.scalars(select(AlertRule).where(AlertRule.enabled.is_(True))).all()
        for rule in rules:
            checked += 1
            try:
                breaching, value, summary = _evaluate_rule(rule)
                if breaching:
                    _fire(db, rule, value, summary)
                else:
                    _resolve(db, rule, value)
            except Exception:  # noqa: BLE001
                logger.exception("failed to evaluate rule %s", rule.name)
    return checked


async def evaluator_loop() -> None:
    logger.info("alert evaluator started (interval %ds)", EVAL_INTERVAL)
    while True:
        try:
            await asyncio.to_thread(evaluate_once)
        except Exception:  # noqa: BLE001
            logger.exception("evaluator cycle failed")
        await asyncio.sleep(EVAL_INTERVAL)
