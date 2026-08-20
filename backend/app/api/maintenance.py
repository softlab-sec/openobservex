"""Maintenance windows API: CRUD.

A maintenance window suppresses alert firing during planned work. The
evaluator checks for an active covering window before creating an
incident (see app/services/evaluator.py::_in_maintenance). All endpoints
are scoped to the caller's organization.

service is optional: omit it (or null) for an org-wide window that
suppresses every rule; set it to a service name to suppress only that
service's rules.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.models import MaintenanceWindow, User
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/maintenance", tags=["maintenance"])


class WindowIn(BaseModel):
    reason: str
    service: str | None = None
    starts_at: datetime
    ends_at: datetime


class WindowOut(BaseModel):
    id: uuid.UUID
    reason: str
    service: str | None
    starts_at: datetime
    ends_at: datetime
    created_by: str | None
    created_at: datetime
    active: bool


def _to_out(w: MaintenanceWindow) -> WindowOut:
    now = datetime.now(timezone.utc)
    return WindowOut(
        id=w.id, reason=w.reason, service=w.service,
        starts_at=w.starts_at, ends_at=w.ends_at,
        created_by=w.created_by, created_at=w.created_at,
        active=(w.starts_at <= now <= w.ends_at),
    )


@router.get("", response_model=list[WindowOut])
def list_windows(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MaintenanceWindow)
        .where(MaintenanceWindow.organization_id == user.organization_id)
        .order_by(MaintenanceWindow.starts_at.desc())
    ).all()
    return [_to_out(w) for w in rows]


@router.post("", response_model=WindowOut, status_code=201, dependencies=[Depends(require_role("member"))])
def create_window(
    body: WindowIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.ends_at <= body.starts_at:
        raise HTTPException(status_code=400, detail="ends_at must be after starts_at")
    w = MaintenanceWindow(
        organization_id=user.organization_id,
        reason=body.reason,
        service=body.service or None,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        created_by=user.email,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return _to_out(w)


@router.delete("/{window_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_window(
    window_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    w = db.scalar(
        select(MaintenanceWindow).where(
            MaintenanceWindow.id == window_id,
            MaintenanceWindow.organization_id == user.organization_id,
        )
    )
    if not w:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
    record_audit(
        db, action="maintenance_window.delete", resource_type="maintenance_window",
        actor=user, resource_id=w.id, resource_name=getattr(w, "name", None),
        before={"name": getattr(w, "name", None)},
        request=request,
    )
    db.delete(w)
    db.commit()
    return None
