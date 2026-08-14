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


def _evaluate_rule(rule: AlertRule) -> tuple[bool, float, str]:
    """Return (breaching, observed_value, human summary) for one rule."""
    mins = rule.for_minutes
    svc = rule.service
    svc_clause = "AND ServiceName = {svc:String}" if svc else ""
    params: dict = {"mins": mins}
    if svc:
        params["svc"] = svc

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

    if status == "firing":
        subject = f"[{sev.upper()}] {service}: {rule.name}"
        body = (
            "ALERT FIRING\n\n"
            f"Severity:    {sev}\n"
            f"Service:     {service}\n"
            f"Alert:       {rule.name}\n\n"
            f"Condition:   {label} is above threshold\n"
            f"Observed:    {observed}\n"
            f"Threshold:   {threshold}\n"
            f"Window:      {rule.for_minutes} minute(s)\n\n"
            f"Triggered:   {when}\n"
        )
    else:
        subject = f"[RESOLVED] {service}: {rule.name}"
        body = (
            "ALERT RESOLVED\n\n"
            f"Severity:    {sev}\n"
            f"Service:     {service}\n"
            f"Alert:       {rule.name}\n\n"
            "The condition has recovered.\n"
            f"Current value: {observed} (threshold {threshold})\n\n"
            f"Resolved:    {when}\n"
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

    text = f":rotating_light: FIRING: {rule.name}\n{summary}"
    if rule.service:
        text += f"\nService: {rule.service}"
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

    text = f":white_check_mark: RESOLVED: {rule.name}\nRecovered (now {value})."
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
