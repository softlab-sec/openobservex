"""Alert rules and incidents API (org-scoped, auth-required)."""

import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.db.clickhouse import ch_query_scoped
from app.api.applications import tenant_dependency
from app.models import AlertRule, Incident, IncidentEvent, User, Anomaly
from app.services import evaluator, notifications

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

KINDS = {"error_rate", "latency", "log_spike", "service_down"}


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: str
    service: str | None = None
    threshold: float
    percentile: int = 95
    for_minutes: int = Field(default=5, ge=1, le=180)
    min_samples: int = Field(default=20, ge=0, le=100000)
    enabled: bool = True
    severity: str = "warning"
    webhook_urls: str | None = None
    channel_ids: str | None = None


class RuleOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    service: str | None
    threshold: float
    percentile: int
    for_minutes: int
    min_samples: int
    enabled: bool
    severity: str
    webhook_urls: str | None
    channel_ids: str | None
    created_at: datetime
    is_firing: bool = False
    last_fired_at: datetime | None = None
    incident_count: int = 0
    model_config = {"from_attributes": True}


class IncidentOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID | None
    rule_name: str
    kind: str
    service: str | None
    status: str
    severity: str
    observed_value: float
    threshold: float
    summary: str
    started_at: datetime
    resolved_at: datetime | None
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    assigned_to: str | None
    model_config = {"from_attributes": True}


@router.get("/rules", response_model=list[RuleOut])
def list_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(AlertRule)
        .where(AlertRule.organization_id == user.organization_id)
        .order_by(AlertRule.created_at.desc())
    ).all()

    out = []
    for r in rows:
        incs = db.scalars(select(Incident).where(Incident.rule_id == r.id)).all()
        firing = any(i.status == "firing" for i in incs)
        last_fired = max((i.started_at for i in incs), default=None)
        ro = RuleOut.model_validate(r)
        ro.is_firing = firing
        ro.last_fired_at = last_fired
        ro.incident_count = len(incs)
        out.append(ro)
    return out


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(
    body: RuleIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(KINDS)}")
    rule = AlertRule(
        organization_id=user.organization_id,
        name=body.name,
        kind=body.kind,
        service=body.service or None,
        threshold=body.threshold,
        percentile=body.percentile,
        for_minutes=body.for_minutes,
        min_samples=body.min_samples,
        enabled=body.enabled,
        severity=body.severity,
        webhook_urls=body.webhook_urls or None,
        channel_ids=body.channel_ids or None,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(
    rule_id: uuid.UUID,
    body: RuleIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.get(AlertRule, rule_id)
    if not rule or rule.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Rule not found")
    if body.kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(KINDS)}")
    for field, value in body.model_dump().items():
        setattr(rule, field, value or None if field in ("service", "webhook_urls") else value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.get(AlertRule, rule_id)
    if not rule or rule.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()


@router.post("/rules/{rule_id}/test")
def test_rule_webhook(
    rule_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a test notification to the rule's webhooks right now."""
    rule = db.get(AlertRule, rule_id)
    if not rule or rule.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Rule not found")
    if not rule.webhook_urls:
        raise HTTPException(status_code=400, detail="Rule has no webhook URLs")
    text = f":test_tube: Test alert from OpenObserveX for rule '{rule.name}'. Webhooks are working."
    payload = {"status": "test", "rule": rule.name}
    results = notifications.notify_all(rule.webhook_urls.split(","), text, payload)
    return {"sent": results}


@router.get("/incidents", response_model=list[IncidentOut])
def list_incidents(
    status: str | None = Query(None, pattern="^(firing|resolved)$"),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Incident).where(Incident.organization_id == user.organization_id)
    if status:
        q = q.where(Incident.status == status)
    q = q.order_by(Incident.started_at.desc()).limit(limit)
    return db.scalars(q).all()


@router.post("/evaluate-now")
def evaluate_now(user: User = Depends(get_current_user)):
    """Manually trigger one evaluation cycle (useful for testing)."""
    checked = evaluator.evaluate_once()
    return {"rules_checked": checked}


# ---------------------------------------------------------------------------
# Incident response: acknowledge / assign / note / resolve + timeline
# ---------------------------------------------------------------------------


class EventOut(BaseModel):
    id: uuid.UUID
    kind: str
    actor: str | None
    detail: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class AssignIn(BaseModel):
    assignee: str = Field(min_length=1, max_length=255)


class NoteIn(BaseModel):
    detail: str = Field(min_length=1, max_length=4000)


def _owned_incident(incident_id: uuid.UUID, user: User, db: Session) -> Incident:
    inc = db.get(Incident, incident_id)
    if not inc or inc.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


def _add_event(db: Session, incident_id: uuid.UUID, kind: str, actor: str | None, detail: str | None) -> None:
    db.add(IncidentEvent(incident_id=incident_id, kind=kind, actor=actor, detail=detail))


@router.get("/incidents/{incident_id}/timeline", response_model=list[EventOut])
def incident_timeline(incident_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned_incident(incident_id, user, db)
    return db.scalars(
        select(IncidentEvent).where(IncidentEvent.incident_id == incident_id).order_by(IncidentEvent.created_at)
    ).all()


@router.post("/incidents/{incident_id}/acknowledge", response_model=IncidentOut)
def acknowledge_incident(incident_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inc = _owned_incident(incident_id, user, db)
    if inc.acknowledged_at is None:
        inc.acknowledged_at = datetime.now(timezone.utc)
        inc.acknowledged_by = user.email
        _add_event(db, inc.id, "acknowledged", user.email, None)
        db.commit()
        db.refresh(inc)
    return inc


@router.post("/incidents/{incident_id}/assign", response_model=IncidentOut)
def assign_incident(incident_id: uuid.UUID, body: AssignIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inc = _owned_incident(incident_id, user, db)
    inc.assigned_to = body.assignee
    _add_event(db, inc.id, "assigned", user.email, f"assigned to {body.assignee}")
    db.commit()
    db.refresh(inc)
    return inc


@router.post("/incidents/{incident_id}/note", response_model=EventOut)
def add_note(incident_id: uuid.UUID, body: NoteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inc = _owned_incident(incident_id, user, db)
    ev = IncidentEvent(incident_id=inc.id, kind="note", actor=user.email, detail=body.detail)
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


@router.post("/incidents/{incident_id}/resolve", response_model=IncidentOut)
def resolve_incident(incident_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inc = _owned_incident(incident_id, user, db)
    if inc.status != "resolved":
        inc.status = "resolved"
        inc.resolved_at = datetime.now(timezone.utc)
        _add_event(db, inc.id, "resolved", user.email, "manually resolved")
        db.commit()
        db.refresh(inc)
    return inc


@router.get("/incidents/{incident_id}/evidence")
async def incident_evidence(
    incident_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _tenant=Depends(tenant_dependency),
):
    """Telemetry that triggered this incident: error breakdown, sample failing
    traces, and the error-rate trend across the window. Scoped to the service."""
    inc = _owned_incident(incident_id, user, db)
    svc = inc.service
    started = inc.started_at

    # If this incident was promoted from an anomaly, learn its metric so the
    # evidence can be latency-aware (latency anomalies have no errors to show).
    inc_metric = "error_rate"
    if inc.kind == "anomaly":
        linked = db.scalar(select(Anomaly).where(Anomaly.promoted_incident_id == inc.id))
        if linked is not None:
            inc_metric = linked.metric

    svc_clause = "AND ServiceName = {svc:String}" if svc else ""
    params = {"start": started.isoformat()}
    if svc:
        params["svc"] = svc

    err_q = f"""
        SELECT ServiceName AS service,
               replaceRegexpAll(Body, '[0-9]{{{{2,}}}}', 'N') AS pattern,
               count() AS occurrences,
               max(Timestamp) AS last_seen
        FROM otel_logs
        WHERE upper(SeverityText) = 'ERROR'
          AND Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        GROUP BY service, pattern
        ORDER BY occurrences DESC
        LIMIT 8
    """
    trace_q = f"""
        SELECT TraceId AS trace_id, ServiceName AS service, SpanName AS operation,
               Duration / 1000000 AS duration_ms, Timestamp AS ts
        FROM otel_traces
        WHERE StatusCode = 'Error'
          AND Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        ORDER BY Timestamp DESC
        LIMIT 10
    """
    trend_q = f"""
        SELECT toStartOfMinute(Timestamp) AS bucket,
               countIf(StatusCode = 'Error') AS errors, count() AS total
        FROM otel_traces
        WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        GROUP BY bucket ORDER BY bucket
    """

    _svc_having = "errors > 0" if inc_metric == "error_rate" else "total > 0"
    _svc_order = "errors DESC" if inc_metric == "error_rate" else "p95_ms DESC"
    svc_breakdown_q = f"""
        SELECT ServiceName AS service,
               countIf(StatusCode = 'Error') AS errors,
               count() AS total,
               round(100 * countIf(StatusCode = 'Error') / count(), 2) AS error_rate,
               round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
        FROM otel_traces
        WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        GROUP BY service
        HAVING {_svc_having}
        ORDER BY {_svc_order}
        LIMIT 10
    """

    if inc_metric == "error_rate":
        triggers_q = f"""
            SELECT ServiceName AS service,
                   SpanName AS endpoint,
                   StatusMessage AS error,
                   count() AS occurrences,
                   round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
                   max(Timestamp) AS last_seen
            FROM otel_traces
            WHERE StatusCode = 'Error'
              AND Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            GROUP BY service, endpoint, error
            ORDER BY occurrences DESC
            LIMIT 10
        """
    else:
        triggers_q = f"""
            SELECT ServiceName AS service,
                   SpanName AS endpoint,
                   concat('p95 ', toString(round(quantile(0.95)(Duration) / 1000000, 1)), 'ms') AS error,
                   count() AS occurrences,
                   round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
                   max(Timestamp) AS last_seen
            FROM otel_traces
            WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            GROUP BY service, endpoint
            HAVING count() > 0
            ORDER BY p95_ms DESC
            LIMIT 10
        """

    def rows(q):
        try:
            res = ch_query_scoped(q, params, app_namespace=None)
            cols = res.column_names
            return [dict(zip(cols, r)) for r in res.result_rows]
        except Exception:
            return []

    errors = rows(err_q)
    services = rows(svc_breakdown_q)
    triggers = rows(triggers_q)
    traces = rows(trace_q)
    trend_raw = rows(trend_q)
    trend = [
        {"bucket": str(t["bucket"]),
         "error_rate": round(100 * t["errors"] / t["total"], 2) if t["total"] else 0.0,
         "errors": t["errors"], "total": t["total"]}
        for t in trend_raw
    ]
    return {
        "incident_id": str(inc.id), "service": svc,
        "observed_value": inc.observed_value, "threshold": inc.threshold, "kind": inc.kind,
        "affected_services": [
            {"service": sv["service"], "errors": sv["errors"], "total": sv["total"],
             "error_rate": float(sv["error_rate"]), "p95_ms": float(sv["p95_ms"])}
            for sv in services
        ],
        "triggers": [
            {"service": tg["service"], "endpoint": tg["endpoint"], "error": tg["error"],
             "occurrences": tg["occurrences"], "p95_ms": float(tg["p95_ms"]), "last_seen": str(tg["last_seen"])}
            for tg in triggers
        ],
        "error_patterns": errors,
        "sample_traces": [
            {"trace_id": t["trace_id"], "service": t["service"], "operation": t["operation"],
             "duration_ms": round(float(t["duration_ms"]), 1), "ts": str(t["ts"])}
            for t in traces
        ],
        "trend": trend,
    }


class AnomalyOut(BaseModel):
    id: uuid.UUID
    service: str
    metric: str
    observed: float
    baseline_mean: float
    baseline_std: float
    z_score: float
    severity: str
    status: str
    occurrences: int
    first_seen: datetime
    last_seen: datetime
    resolved_at: datetime | None
    promoted_incident_id: uuid.UUID | None
    resolution: str
    model_config = {"from_attributes": True}


@router.get("/anomalies", response_model=list[AnomalyOut])
def list_anomalies(
    status: str | None = Query(None, pattern="^(active|resolved)$"),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Anomaly).where(Anomaly.organization_id == user.organization_id)
    if status:
        q = q.where(Anomaly.status == status)
    q = q.order_by(Anomaly.last_seen.desc()).limit(limit)
    return db.scalars(q).all()


def _owned_anomaly(anomaly_id, user, db):
    a = db.get(Anomaly, anomaly_id)
    if a is None or a.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="anomaly not found")
    return a


@router.get("/anomalies/{anomaly_id}", response_model=AnomalyOut)
def get_anomaly(anomaly_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _owned_anomaly(anomaly_id, user, db)



def _anomaly_summary(a, services, triggers):
    """Deterministic executive overview of an anomaly from its evidence.
    Metric-aware: describes the deviation, the dominant operation, blast radius,
    and a plain-language read of what it likely means."""
    metric_label = "error rate" if a.metric == "error_rate" else "p95 latency"
    unit = "%" if a.metric == "error_rate" else "ms"
    obs = f"{round(a.observed, 1)}{unit}"
    base = f"{round(a.baseline_mean, 1)}{unit}"
    mult = (a.observed / a.baseline_mean) if a.baseline_mean else 0

    parts = []
    parts.append(
        f"{a.service} {metric_label} is {obs}, "
        f"{('%.1fx' % mult) if mult else 'well'} above its baseline of {base} "
        f"(z={round(a.z_score, 1)})."
    )

    if triggers:
        top = triggers[0]
        if a.metric == "error_rate":
            parts.append(
                f"The failures concentrate on {top['endpoint']} "
                f"(\"{top['error']}\", {top['occurrences']}x)."
            )
        else:
            parts.append(
                f"The slowest operation is {top['endpoint']} at p95 {round(float(top['p95_ms']), 0)}ms."
            )

    n_services = len(services)
    if n_services <= 1:
        parts.append("It is isolated to this one service, so the cause is likely local to it (its own code, a dependency, or its resources) rather than a systemic outage.")
    else:
        others = ", ".join(sv["service"] for sv in services[:4] if sv["service"] != a.service)
        parts.append(f"It spans {n_services} services ({others}), suggesting a shared dependency or upstream cause rather than a single-service issue.")

    if a.metric == "error_rate":
        parts.append("Investigate the failing operation's downstream dependency or recent deploy; a concentrated error message usually points to one specific fault.")
    else:
        parts.append("Latency without errors typically means a slow dependency, resource contention, or lock/queue buildup rather than outright failure.")

    return " ".join(parts)



def _anomaly_analysis(a, services, triggers, traces):
    """Deterministic RCA-style analysis from evidence. No AI, no faked numbers.
    Confidence is computed from how concentrated the failure signal is."""
    metric = a.metric
    unit = "%" if metric == "error_rate" else "ms"

    n_services = len(services)
    n_ops = len(triggers)
    if metric == "error_rate":
        failed = sum(int(sv.get("errors", 0)) for sv in services)
    else:
        failed = sum(int(tg.get("occurrences", 0)) for tg in triggers)

    if a.severity == "critical":
        user_impact = "High"
    elif a.severity == "warning":
        user_impact = "Medium"
    else:
        user_impact = "Low"

    likely_cause = "Undetermined"
    top = triggers[0] if triggers else None
    if top:
        if metric == "error_rate":
            likely_cause = f"{top['error']} on {top['endpoint']}"
        else:
            likely_cause = f"Slow {top['endpoint']} (p95 {round(float(top['p95_ms']))}ms)"

    total_trigger = sum(int(t.get("occurrences", 0)) for t in triggers) or 1
    top_share = (int(top["occurrences"]) / total_trigger) if top else 0.0
    locality = 1.0 if n_services <= 1 else 0.7
    strength = min(1.0, abs(a.z_score) / 10.0)
    confidence = round(min(0.99, 0.35 + 0.4 * top_share + 0.15 * locality + 0.1 * strength) * 100)

    evidence = []
    if top:
        if metric == "error_rate":
            evidence.append(f"{top['endpoint']} produced {round(top_share*100)}% of failures ({top['occurrences']}x)")
            evidence.append(f'dominant error: "{top["error"]}"')
        else:
            evidence.append(f"{top['endpoint']} is the slowest operation at p95 {round(float(top['p95_ms']))}ms")
    evidence.append(f"deviation of {round(abs(a.z_score),1)} sigma from a baseline of {round(a.baseline_mean,1)}{unit}")
    if n_services <= 1:
        evidence.append("signal isolated to a single service")
    else:
        evidence.append(f"signal spans {n_services} services")

    factors = []
    if metric == "error_rate":
        factors.append("Error-rate spike")
        if any(float(sv.get("p95_ms", 0)) > 100 for sv in services):
            factors.append("Elevated latency")
        if n_services > 1:
            factors.append("Cross-service propagation")
    else:
        factors.append("Latency spike")
        factors.append("Possible dependency slowdown or resource contention")
        if n_services > 1:
            factors.append("Cross-service propagation")

    return {
        "impact": {
            "affected_services": n_services,
            "affected_operations": n_ops,
            "failed_requests": failed,
            "user_impact": user_impact,
            "likely_cause": likely_cause,
        },
        "rca": {
            "likely_cause": likely_cause,
            "confidence": confidence,
            "evidence": evidence,
            "contributing_factors": factors,
        },
    }


@router.get("/anomalies/{anomaly_id}/evidence")
async def anomaly_evidence(
    anomaly_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _tenant=Depends(tenant_dependency),
):
    """Correlated evidence for an anomaly: affected services, triggering
    operations, sample failing traces, and the metric trend across the window.
    Scoped to the anomaly's service and its active window."""
    a = _owned_anomaly(anomaly_id, user, db)
    svc = a.service
    started = a.first_seen

    svc_clause = "AND ServiceName = {svc:String}" if svc else ""
    params = {"start": started.isoformat()}
    if svc:
        params["svc"] = svc

    svc_breakdown_q = f"""
        SELECT ServiceName AS service,
               countIf(StatusCode = 'Error') AS errors,
               count() AS total,
               round(100 * countIf(StatusCode = 'Error') / count(), 2) AS error_rate,
               round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
        FROM otel_traces
        WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        GROUP BY service
        HAVING total > 0
        ORDER BY errors DESC
        LIMIT 10
    """
    if a.metric == "error_rate":
        # failing operations, ranked by how often they fail
        triggers_q = f"""
            SELECT ServiceName AS service,
                   SpanName AS endpoint,
                   StatusMessage AS error,
                   count() AS occurrences,
                   round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
                   max(Timestamp) AS last_seen
            FROM otel_traces
            WHERE StatusCode = 'Error'
              AND Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            GROUP BY service, endpoint, error
            ORDER BY occurrences DESC
            LIMIT 10
        """
        trace_q = f"""
            SELECT TraceId AS trace_id, ServiceName AS service, SpanName AS operation,
                   Duration / 1000000 AS duration_ms, Timestamp AS ts
            FROM otel_traces
            WHERE StatusCode = 'Error'
              AND Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            ORDER BY Timestamp DESC
            LIMIT 10
        """
    else:
        # p95_latency: slowest operations, ranked by p95; "error" column carries a latency note
        triggers_q = f"""
            SELECT ServiceName AS service,
                   SpanName AS endpoint,
                   concat('p95 ', toString(round(quantile(0.95)(Duration) / 1000000, 1)), 'ms') AS error,
                   count() AS occurrences,
                   round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
                   max(Timestamp) AS last_seen
            FROM otel_traces
            WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            GROUP BY service, endpoint
            HAVING count() > 0
            ORDER BY p95_ms DESC
            LIMIT 10
        """
        trace_q = f"""
            SELECT TraceId AS trace_id, ServiceName AS service, SpanName AS operation,
                   Duration / 1000000 AS duration_ms, Timestamp AS ts
            FROM otel_traces
            WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
              {svc_clause}
              AND {{tenant_scope}}
            ORDER BY Duration DESC
            LIMIT 10
        """
    trend_q = f"""
        SELECT toStartOfMinute(Timestamp) AS bucket,
               countIf(StatusCode = 'Error') AS errors, count() AS total,
               round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
        FROM otel_traces
        WHERE Timestamp >= parseDateTimeBestEffort({{start:String}})
          {svc_clause}
          AND {{tenant_scope}}
        GROUP BY bucket ORDER BY bucket
    """

    def rows(q):
        try:
            res = ch_query_scoped(q, params, app_namespace=None)
            cols = res.column_names
            return [dict(zip(cols, r)) for r in res.result_rows]
        except Exception:
            return []

    services = rows(svc_breakdown_q)
    triggers = rows(triggers_q)
    traces = rows(trace_q)
    trend_raw = rows(trend_q)

    if a.metric == "error_rate":
        trend = [
            {"bucket": str(t["bucket"]),
             "value": round(100 * t["errors"] / t["total"], 2) if t["total"] else 0.0}
            for t in trend_raw
        ]
    else:
        trend = [{"bucket": str(t["bucket"]), "value": float(t["p95_ms"])} for t in trend_raw]

    return {
        "anomaly_id": str(a.id),
        "service": svc,
        "metric": a.metric,
        "observed": a.observed,
        "baseline_mean": a.baseline_mean,
        "z_score": a.z_score,
        "summary": _anomaly_summary(a, services, triggers),
        "analysis": _anomaly_analysis(a, services, triggers, traces),
        "affected_services": [
            {"service": sv["service"], "errors": sv["errors"], "total": sv["total"],
             "error_rate": float(sv["error_rate"]), "p95_ms": float(sv["p95_ms"])}
            for sv in services
        ],
        "triggers": [
            {"service": tg["service"], "endpoint": tg["endpoint"], "error": tg["error"],
             "occurrences": tg["occurrences"], "p95_ms": float(tg["p95_ms"]), "last_seen": str(tg["last_seen"])}
            for tg in triggers
        ],
        "sample_traces": [
            {"trace_id": t["trace_id"], "service": t["service"], "operation": t["operation"],
             "duration_ms": round(float(t["duration_ms"]), 1), "ts": str(t["ts"])}
            for t in traces
        ],
        "trend": trend,
    }


SUPPRESS_MINUTES = 10  # after a manual resolve/dismiss, detector won't reopen this (service,metric) for this long


@router.post("/anomalies/{anomaly_id}/resolve", response_model=AnomalyOut)
def resolve_anomaly(anomaly_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Manually resolve an anomaly. Applies a suppression cooldown so the
    detector will not immediately reopen it."""
    a = _owned_anomaly(anomaly_id, user, db)
    now = datetime.now(timezone.utc)
    a.status = "resolved"
    a.resolution = "manual"
    a.resolved_at = now
    a.suppressed_until = now + timedelta(minutes=SUPPRESS_MINUTES)
    if a.promoted_incident_id:
        inc = db.get(Incident, a.promoted_incident_id)
        if inc and inc.status == "firing":
            inc.status = "resolved"
            inc.resolved_at = now
    db.commit()
    db.refresh(a)
    return a


@router.post("/anomalies/{anomaly_id}/dismiss", response_model=AnomalyOut)
def dismiss_anomaly(anomaly_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Dismiss an anomaly as a false positive. Same mechanics as resolve, but
    labeled 'dismissed' so real resolutions can be told apart from noise."""
    a = _owned_anomaly(anomaly_id, user, db)
    now = datetime.now(timezone.utc)
    a.status = "resolved"
    a.resolution = "dismissed"
    a.resolved_at = now
    a.suppressed_until = now + timedelta(minutes=SUPPRESS_MINUTES)
    if a.promoted_incident_id:
        inc = db.get(Incident, a.promoted_incident_id)
        if inc and inc.status == "firing":
            inc.status = "resolved"
            inc.resolved_at = now
    db.commit()
    db.refresh(a)
    return a


@router.post("/anomalies/{anomaly_id}/escalate", response_model=AnomalyOut)
def escalate_anomaly(anomaly_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Manually promote an active anomaly to an incident now, without waiting
    for the sustained-hits threshold."""
    a = _owned_anomaly(anomaly_id, user, db)
    if a.promoted_incident_id:
        raise HTTPException(status_code=409, detail="anomaly already promoted to an incident")
    if a.status != "active":
        raise HTTPException(status_code=409, detail="only active anomalies can be escalated")
    metric_label = "error rate" if a.metric == "error_rate" else "p95 latency"
    unit = "%" if a.metric == "error_rate" else "ms"
    summary = (
        f"anomalous {metric_label} on {a.service}: "
        f"{a.observed}{unit} vs baseline {round(a.baseline_mean, 2)}{unit} "
        f"(z={round(a.z_score, 1)}) [manually escalated]"
    )
    inc = Incident(
        organization_id=user.organization_id,
        rule_id=None,
        rule_name=f"Anomaly: {metric_label} on {a.service}",
        kind="anomaly",
        service=a.service,
        severity=a.severity,
        status="firing",
        observed_value=a.observed,
        threshold=round(a.baseline_mean, 3),
        summary=summary,
        started_at=datetime.now(timezone.utc),
    )
    db.add(inc)
    db.flush()
    a.promoted_incident_id = inc.id
    db.commit()
    db.refresh(a)
    return a
