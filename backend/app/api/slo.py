"""Service Level Objectives API (org-scoped, auth-required)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.db.clickhouse import ch_query
from app.models import SLO, User
from app.services import slo as slo_engine
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/slos", tags=["slos"])

SLI_TYPES = {"availability", "latency"}

# window for inventory discovery: wide enough that recently-quiet targets still appear
_INVENTORY_WINDOW_HOURS = 168  # 7 days


def _ch_rows(result) -> list[dict]:
    """Minimal ClickHouse row-dictifier for inventory pick-lists."""
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]


@router.get("/inventory")
def slo_inventory(user: User = Depends(get_current_user)):
    """Live, selectable inventory for building SLOs: real services, endpoints,
    and infrastructure discovered from telemetry rather than typed free-text.

    Defined before any /{slo_id} route so "inventory" is never parsed as an id.
    """
    services = _ch_rows(ch_query(
        """
        SELECT DISTINCT ServiceName AS service
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {h:UInt32} HOUR
          AND ServiceName != ''
        ORDER BY service
        """,
        {"h": _INVENTORY_WINDOW_HOURS},
    ))
    endpoints = _ch_rows(ch_query(
        """
        SELECT DISTINCT ServiceName AS service, SpanName AS endpoint
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {h:UInt32} HOUR
          AND ServiceName != '' AND SpanName != ''
        ORDER BY service, endpoint
        """,
        {"h": _INVENTORY_WINDOW_HOURS},
    ))
    infrastructure = _ch_rows(ch_query(
        """
        SELECT DISTINCT ResourceAttributes['service.instance.id'] AS host
        FROM otel_metrics_gauge
        WHERE MetricName LIKE 'node_%'
          AND TimeUnix >= now() - INTERVAL {h:UInt32} HOUR
          AND ResourceAttributes['service.instance.id'] != ''
        ORDER BY host
        """,
        {"h": _INVENTORY_WINDOW_HOURS},
    ))
    return {
        "services": [r["service"] for r in services],
        "endpoints": endpoints,
        "infrastructure": [r["host"] for r in infrastructure],
    }


class SLOIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    owner: str | None = Field(default=None, max_length=255)
    team: str | None = Field(default=None, max_length=255)
    tags: str | None = Field(default=None, max_length=1024)
    sli_type: str = "availability"
    target_kind: str = "service"
    service: str | None = None
    target_ref: str | None = Field(default=None, max_length=255)
    target: float = Field(ge=0, le=100)
    window_days: int = Field(default=30, ge=1, le=365)
    latency_threshold_ms: float | None = None
    enabled: bool = True


class SLOUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    owner: str | None = Field(default=None, max_length=255)
    team: str | None = Field(default=None, max_length=255)
    tags: str | None = Field(default=None, max_length=1024)
    sli_type: str | None = None
    target_kind: str | None = None
    service: str | None = None
    target_ref: str | None = Field(default=None, max_length=255)
    target: float | None = Field(default=None, ge=0, le=100)
    window_days: int | None = Field(default=None, ge=1, le=365)
    latency_threshold_ms: float | None = None
    enabled: bool | None = None


class SLOOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    owner: str | None
    team: str | None
    tags: str | None
    sli_type: str
    target_kind: str
    service: str | None
    target_ref: str | None
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


# what an SLO can be attached to. api/endpoint resolve to the same telemetry
# (a SpanName on a service); the distinction is preserved for the future
# curated service registry but treated identically at query time for now.
TARGET_KINDS = {"service", "api", "endpoint", "infrastructure"}


def _validate(
    sli_type: str,
    latency_threshold_ms: float | None,
    target_kind: str,
    service: str | None,
    target_ref: str | None,
):
    if sli_type not in SLI_TYPES:
        raise HTTPException(status_code=400, detail=f"sli_type must be one of {sorted(SLI_TYPES)}")
    if sli_type == "latency" and not latency_threshold_ms:
        raise HTTPException(
            status_code=400,
            detail="latency SLOs require latency_threshold_ms (a millisecond target)",
        )
    if target_kind not in TARGET_KINDS:
        raise HTTPException(status_code=400, detail=f"target_kind must be one of {sorted(TARGET_KINDS)}")
    # services own SLOs: everything except infrastructure must name an owning service
    if target_kind in {"service", "api", "endpoint"} and not (service and service.strip()):
        raise HTTPException(
            status_code=400,
            detail=f"a {target_kind} SLO must specify the owning service",
        )
    # api/endpoint SLOs point at a specific route; require the reference
    if target_kind in {"api", "endpoint"} and not (target_ref and target_ref.strip()):
        raise HTTPException(
            status_code=400,
            detail=f"a {target_kind} SLO must specify target_ref (the endpoint)",
        )
    # infrastructure SLOs point at a host/component
    if target_kind == "infrastructure" and not (target_ref and target_ref.strip()):
        raise HTTPException(
            status_code=400,
            detail="an infrastructure SLO must specify target_ref (the host or component)",
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
    # a service SLO's target IS the service; default the ref so every SLO has one
    target_ref = body.target_ref
    if body.target_kind == "service" and not (target_ref and target_ref.strip()):
        target_ref = body.service
    _validate(body.sli_type, body.latency_threshold_ms, body.target_kind, body.service, target_ref)
    slo = SLO(
        organization_id=user.organization_id,
        name=body.name,
        description=body.description or None,
        owner=body.owner or None,
        team=body.team or None,
        tags=body.tags or None,
        sli_type=body.sli_type,
        target_kind=body.target_kind,
        service=body.service or None,
        target_ref=target_ref or None,
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
            "name": slo.name, "sli_type": slo.sli_type, "target_kind": slo.target_kind,
            "service": slo.service, "target_ref": slo.target_ref,
            "target": slo.target, "window_days": slo.window_days,
            "latency_threshold_ms": slo.latency_threshold_ms, "enabled": slo.enabled,
            "owner": slo.owner, "team": slo.team, "tags": slo.tags,
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
    fields = [
        "name", "description", "owner", "team", "tags",
        "sli_type", "target_kind", "service", "target_ref",
        "target", "window_days", "latency_threshold_ms", "enabled",
    ]
    before, after = {}, {}
    data = body.model_dump(exclude_unset=True)
    for f in fields:
        if f in data and data[f] != getattr(slo, f):
            before[f] = getattr(slo, f)
            setattr(slo, f, data[f])
            after[f] = data[f]
    _validate(slo.sli_type, slo.latency_threshold_ms, slo.target_kind, slo.service, slo.target_ref)
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


@router.post("/{slo_id}/clone", response_model=SLOOut, status_code=201, dependencies=[Depends(require_role("member"))])
def clone_slo(
    slo_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Duplicate an SLO's definition as a new, unevaluated SLO."""
    src = _get_owned(slo_id, user, db)
    clone = SLO(
        organization_id=user.organization_id,
        name=f"{src.name} (copy)",
        description=src.description,
        owner=src.owner,
        team=src.team,
        tags=src.tags,
        sli_type=src.sli_type,
        target_kind=src.target_kind,
        service=src.service,
        target_ref=src.target_ref,
        target=src.target,
        window_days=src.window_days,
        latency_threshold_ms=src.latency_threshold_ms,
        enabled=src.enabled,
        # status fields intentionally left NULL: a clone hasn't been evaluated yet
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    record_audit(
        db, action="slo.create", resource_type="slo",
        actor=user, resource_id=clone.id, resource_name=clone.name,
        after={
            "name": clone.name, "sli_type": clone.sli_type, "target_kind": clone.target_kind,
            "service": clone.service, "target_ref": clone.target_ref,
            "target": clone.target, "cloned_from": str(src.id),
        },
        request=request,
    )
    return clone
