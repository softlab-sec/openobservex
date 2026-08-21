"""Service Level Objectives API (org-scoped, auth-required)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.models import SLO, User
from app.services import slo as slo_engine
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/slos", tags=["slos"])

SLI_TYPES = {"availability", "latency"}


class SLOIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sli_type: str = "availability"
    service: str | None = None
    target: float = Field(ge=0, le=100)
    window_days: int = Field(default=30, ge=1, le=365)
    latency_threshold_ms: float | None = None
    enabled: bool = True


class SLOUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sli_type: str | None = None
    service: str | None = None
    target: float | None = Field(default=None, ge=0, le=100)
    window_days: int | None = Field(default=None, ge=1, le=365)
    latency_threshold_ms: float | None = None
    enabled: bool | None = None


class SLOOut(BaseModel):
    id: uuid.UUID
    name: str
    sli_type: str
    service: str | None
    target: float
    window_days: int
    latency_threshold_ms: float | None
    enabled: bool
    current_sli: float | None
    budget_remaining_pct: float | None
    burn_rate: float | None
    total_events: int | None
    is_meeting: bool | None
    last_evaluated_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


def _validate(sli_type: str, latency_threshold_ms: float | None):
    if sli_type not in SLI_TYPES:
        raise HTTPException(status_code=400, detail=f"sli_type must be one of {sorted(SLI_TYPES)}")
    if sli_type == "latency" and not latency_threshold_ms:
        raise HTTPException(
            status_code=400,
            detail="latency SLOs require latency_threshold_ms (a millisecond target)",
        )


@router.get("", response_model=list[SLOOut])
def list_slos(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(SLO).where(SLO.organization_id == user.organization_id).order_by(SLO.created_at.desc())
    ).all()
    return list(rows)


@router.post("", response_model=SLOOut, status_code=201, dependencies=[Depends(require_role("member"))])
def create_slo(
    body: SLOIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate(body.sli_type, body.latency_threshold_ms)
    slo = SLO(
        organization_id=user.organization_id,
        name=body.name,
        sli_type=body.sli_type,
        service=body.service or None,
        target=body.target,
        window_days=body.window_days,
        latency_threshold_ms=body.latency_threshold_ms,
        enabled=body.enabled,
    )
    db.add(slo)
    db.commit()
    db.refresh(slo)
    record_audit(
        db, action="slo.create", resource_type="slo",
        actor=user, resource_id=slo.id, resource_name=slo.name,
        after={
            "name": slo.name, "sli_type": slo.sli_type, "service": slo.service,
            "target": slo.target, "window_days": slo.window_days,
            "latency_threshold_ms": slo.latency_threshold_ms, "enabled": slo.enabled,
        },
        request=request,
    )
    return slo


def _get_owned(slo_id: uuid.UUID, user: User, db: Session) -> SLO:
    slo = db.scalar(
        select(SLO).where(SLO.id == slo_id, SLO.organization_id == user.organization_id)
    )
    if slo is None:
        raise HTTPException(status_code=404, detail="SLO not found")
    return slo


@router.patch("/{slo_id}", response_model=SLOOut, dependencies=[Depends(require_role("member"))])
def update_slo(
    slo_id: uuid.UUID,
    body: SLOUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    slo = _get_owned(slo_id, user, db)
    fields = ["name", "sli_type", "service", "target", "window_days", "latency_threshold_ms", "enabled"]
    before, after = {}, {}
    data = body.model_dump(exclude_unset=True)
    for f in fields:
        if f in data and data[f] != getattr(slo, f):
            before[f] = getattr(slo, f)
            setattr(slo, f, data[f])
            after[f] = data[f]
    _validate(slo.sli_type, slo.latency_threshold_ms)
    # a definition change invalidates the cached status until re-evaluated
    if after:
        slo.current_sli = None
        slo.budget_remaining_pct = None
        slo.burn_rate = None
        slo.is_meeting = None
    db.commit()
    db.refresh(slo)
    if after:
        record_audit(
            db, action="slo.update", resource_type="slo",
            actor=user, resource_id=slo.id, resource_name=slo.name,
            before=before, after=after, request=request,
        )
    return slo


@router.delete("/{slo_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_slo(
    slo_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    slo = _get_owned(slo_id, user, db)
    # capture before-state BEFORE deleting (record survives removal)
    record_audit(
        db, action="slo.delete", resource_type="slo",
        actor=user, resource_id=slo.id, resource_name=slo.name,
        before={
            "name": slo.name, "sli_type": slo.sli_type, "service": slo.service,
            "target": slo.target, "window_days": slo.window_days,
        },
        request=request,
    )
    db.delete(slo)
    db.commit()
    return None


@router.post("/{slo_id}/evaluate", response_model=SLOOut, dependencies=[Depends(require_role("member"))])
def evaluate_slo_now(
    slo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute this SLO's status immediately and store it (no waiting for the worker)."""
    slo = _get_owned(slo_id, user, db)
    status = slo_engine.evaluate_slo(slo)
    # on-demand refresh updates the cached snapshot only; the worker owns the
    # evenly-spaced history series that the analytics depend on.
    slo_engine.apply_status(slo, status)
    db.commit()
    db.refresh(slo)
    return slo
