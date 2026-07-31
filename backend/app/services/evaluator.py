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
from app.models import AlertRule, Incident
from app.services import notifications

logger = logging.getLogger(__name__)

EVAL_INTERVAL = 60  # seconds


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
        breaching = (pct or 0) > rule.threshold
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
        breaching = (p or 0) > rule.threshold
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
        breaching = (errors or 0) > rule.threshold
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


def _fire(db, rule: AlertRule, value: float, summary: str) -> None:
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
        kind=rule.kind,
        service=rule.service,
        status="firing",
        observed_value=value,
        threshold=rule.threshold,
        summary=summary,
    )
    db.add(inc)
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
    _notify_channels(db, rule, f"FIRING: {rule.name}", f"{summary}" + (f"\nService: {rule.service}" if rule.service else ""))
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
    _notify_channels(db, rule, f"RESOLVED: {rule.name}", f"Recovered (now {value}).")
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
