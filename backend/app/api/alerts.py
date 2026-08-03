"""Alert rules and incidents API (org-scoped, auth-required)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.db.clickhouse import ch_query_scoped
from app.api.applications import tenant_dependency
from app.models import AlertRule, Incident, IncidentEvent, User
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
    rule_id: uuid.UUID
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
        HAVING errors > 0
        ORDER BY errors DESC
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
        "error_patterns": errors,
        "sample_traces": [
            {"trace_id": t["trace_id"], "service": t["service"], "operation": t["operation"],
             "duration_ms": round(float(t["duration_ms"]), 1), "ts": str(t["ts"])}
            for t in traces
        ],
        "trend": trend,
    }
