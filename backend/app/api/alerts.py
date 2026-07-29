"""Alert rules and incidents API (org-scoped, auth-required)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.models import AlertRule, Incident, User
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
    webhook_urls: str | None = None


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
    webhook_urls: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class IncidentOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID
    rule_name: str
    kind: str
    service: str | None
    status: str
    observed_value: float
    threshold: float
    summary: str
    started_at: datetime
    resolved_at: datetime | None
    model_config = {"from_attributes": True}


@router.get("/rules", response_model=list[RuleOut])
def list_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(AlertRule)
        .where(AlertRule.organization_id == user.organization_id)
        .order_by(AlertRule.created_at.desc())
    ).all()
    return rows


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
        webhook_urls=body.webhook_urls or None,
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
