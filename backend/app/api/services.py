"""Service registry API (org-scoped, auth-required).

An overlay on telemetry-discovered services: discovery (distinct ServiceName in
otel_traces) stays the source of truth for which services exist; this registry
adds curated metadata -- ownership, criticality, and the SLA commitment -- keyed
by service name within the organization. A row may also pre-register a service
that is not emitting telemetry yet.

The SLA stored on a service is the reliability COMMITMENT it makes; the SLOs
attached to it (slos.service) are the operational measurements that evidence the
commitment. The two are deliberately distinct.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.db.clickhouse import ch_query
from app.models import SLO, Service, User
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/services", tags=["services"])

# how far back discovery looks for live services (matches the SLO inventory window)
_DISCOVERY_WINDOW_HOURS = 168  # 7 days

CRITICALITY = {"tier1", "tier2", "tier3", "tier4"}
SLA_METRICS = {"availability", "latency"}


class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    owner: str | None = Field(default=None, max_length=255)
    team: str | None = Field(default=None, max_length=255)
    tags: str | None = Field(default=None, max_length=1024)
    criticality: str = Field(default="tier3")
    sla_target_pct: float | None = Field(default=None, ge=0, le=100)
    sla_window_days: int | None = Field(default=None, ge=1, le=3650)
    sla_metric: str | None = Field(default=None)


class ServicePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    owner: str | None = Field(default=None, max_length=255)
    team: str | None = Field(default=None, max_length=255)
    tags: str | None = Field(default=None, max_length=1024)
    criticality: str | None = Field(default=None)
    sla_target_pct: float | None = Field(default=None, ge=0, le=100)
    sla_window_days: int | None = Field(default=None, ge=1, le=3650)
    sla_metric: str | None = Field(default=None)


class ServiceOut(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str | None
    description: str | None
    owner: str | None
    team: str | None
    tags: str | None
    criticality: str
    sla_target_pct: float | None
    sla_window_days: int | None
    sla_metric: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ServiceRow(BaseModel):
    """One row of the merged registry view: a service's identity, whether it was
    discovered from telemetry, whether it is curated, its metadata, and how many
    SLOs are attached to it."""
    name: str
    discovered: bool
    registered: bool
    slo_count: int
    id: uuid.UUID | None = None
    display_name: str | None = None
    description: str | None = None
    owner: str | None = None
    team: str | None = None
    tags: str | None = None
    criticality: str | None = None
    sla_target_pct: float | None = None
    sla_window_days: int | None = None
    sla_metric: str | None = None


def _validate(criticality, sla_metric):
    if criticality is not None and criticality not in CRITICALITY:
        raise HTTPException(422, f"criticality must be one of {sorted(CRITICALITY)}")
    if sla_metric is not None and sla_metric not in SLA_METRICS:
        raise HTTPException(422, f"sla_metric must be one of {sorted(SLA_METRICS)}")


def _discovered_names() -> set[str]:
    """Distinct ServiceNames seen in traces within the discovery window."""
    rows = ch_query(
        """
        SELECT DISTINCT ServiceName AS service
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {h:UInt32} HOUR
          AND ServiceName != ''
        """,
        {"h": _DISCOVERY_WINDOW_HOURS},
    )
    return {r[0] for r in rows.result_rows}


def _slo_counts(db: Session, org_id: uuid.UUID) -> dict:
    rows = db.execute(
        select(SLO.service, func.count(SLO.id))
        .where(SLO.organization_id == org_id, SLO.service.is_not(None))
        .group_by(SLO.service)
    ).all()
    return {name: n for name, n in rows}


@router.get("", response_model=list[ServiceRow])
def list_services(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Merged registry view: every discovered service plus every curated service,
    with metadata and SLO count. Discovery and the registry are unioned by name,
    so an uncurated service still appears (registered=False) and a pre-registered
    service appears before it emits telemetry (discovered=False)."""
    discovered = _discovered_names()
    registered = db.scalars(
        select(Service).where(Service.organization_id == user.organization_id)
    ).all()
    counts = _slo_counts(db, user.organization_id)
    by_name: dict = {}
    for name in discovered:
        by_name[name] = ServiceRow(
            name=name, discovered=True, registered=False, slo_count=counts.get(name, 0)
        )
    for svc in registered:
        row = by_name.get(svc.name)
        if row is None:
            row = ServiceRow(
                name=svc.name, discovered=False, registered=True,
                slo_count=counts.get(svc.name, 0),
            )
            by_name[svc.name] = row
        row.registered = True
        row.id = svc.id
        row.display_name = svc.display_name
        row.description = svc.description
        row.owner = svc.owner
        row.team = svc.team
        row.tags = svc.tags
        row.criticality = svc.criticality
        row.sla_target_pct = svc.sla_target_pct
        row.sla_window_days = svc.sla_window_days
        row.sla_metric = svc.sla_metric
    return sorted(by_name.values(), key=lambda r: r.name)


@router.get("/{service_id}", response_model=ServiceOut)
def get_service(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, service_id)
    if not svc or svc.organization_id != user.organization_id:
        raise HTTPException(404, "Service not found")
    return svc


@router.post("", response_model=ServiceOut, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_service(
    body: ServiceIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate(body.criticality, body.sla_metric)
    existing = db.scalar(
        select(Service).where(
            Service.organization_id == user.organization_id, Service.name == body.name
        )
    )
    if existing:
        raise HTTPException(409, "a service with this name is already registered")
    svc = Service(
        organization_id=user.organization_id,
        name=body.name,
        display_name=body.display_name,
        description=body.description,
        owner=body.owner,
        team=body.team,
        tags=body.tags,
        criticality=body.criticality,
        sla_target_pct=body.sla_target_pct,
        sla_window_days=body.sla_window_days,
        sla_metric=body.sla_metric,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    record_audit(
        db, action="service.create", resource_type="service",
        actor=user, resource_id=svc.id, resource_name=svc.name,
        after={
            "name": svc.name, "owner": svc.owner, "team": svc.team,
            "criticality": svc.criticality, "sla_target_pct": svc.sla_target_pct,
            "sla_window_days": svc.sla_window_days, "sla_metric": svc.sla_metric,
        },
        request=request,
    )
    return svc


@router.patch("/{service_id}", response_model=ServiceOut, dependencies=[Depends(require_role("admin"))])
def update_service(
    service_id: uuid.UUID,
    body: ServicePatch,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, service_id)
    if not svc or svc.organization_id != user.organization_id:
        raise HTTPException(404, "Service not found")
    fields = body.model_dump(exclude_unset=True)
    _validate(fields.get("criticality"), fields.get("sla_metric"))
    before, after = {}, {}
    for k, v in fields.items():
        old = getattr(svc, k)
        if old != v:
            before[k] = old
            after[k] = v
            setattr(svc, k, v)
    if after:
        db.commit()
        db.refresh(svc)
        record_audit(
            db, action="service.update", resource_type="service",
            actor=user, resource_id=svc.id, resource_name=svc.name,
            before=before, after=after, request=request,
        )
    return svc


@router.delete("/{service_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_service(
    service_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, service_id)
    if not svc or svc.organization_id != user.organization_id:
        raise HTTPException(404, "Service not found")
    record_audit(
        db, action="service.delete", resource_type="service",
        actor=user, resource_id=svc.id, resource_name=svc.name,
        before={"name": svc.name, "owner": svc.owner, "criticality": svc.criticality},
        detail="removes curated metadata; the service still exists in telemetry",
        request=request,
    )
    db.delete(svc)
    db.commit()
