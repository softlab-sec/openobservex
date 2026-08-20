"""Audit log query API (admin-only, read-only).

There is deliberately no create/update/delete here — the audit log is
append-only and is written only by record_audit at mutation points. This
router just lets admins read and filter the trail.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from app.core.roles import require_role
from app.db.postgres import get_db
from app.models import AuditLog, User

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


class AuditRow(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_email: str
    actor_role: str
    action: str
    resource_type: str
    resource_id: str | None
    resource_name: str | None
    before: dict | None
    after: dict | None
    ip_address: str | None
    detail: str | None
    model_config = {"from_attributes": True}


class AuditPage(BaseModel):
    rows: list[AuditRow]
    total: int
    limit: int
    offset: int


@router.get("", response_model=AuditPage)
def list_audit(
    start: datetime | None = Query(None, description="UTC lower bound (inclusive)"),
    end: datetime | None = Query(None, description="UTC upper bound (inclusive)"),
    actor_email: str | None = Query(None),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    q: str | None = Query(None, description="free-text over resource name and detail"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    # Org-scoped: an admin sees their org's trail. Rows with a null org
    # (e.g. failed logins for unknown emails) are visible too, since those are
    # security events any admin should be able to review.
    base = select(AuditLog).where(
        or_(
            AuditLog.organization_id == user.organization_id,
            AuditLog.organization_id.is_(None),
        )
    )
    if start is not None:
        base = base.where(AuditLog.created_at >= start)
    if end is not None:
        base = base.where(AuditLog.created_at <= end)
    if actor_email:
        base = base.where(AuditLog.actor_email.ilike(f"%{actor_email}%"))
    if action:
        base = base.where(AuditLog.action == action)
    if resource_type:
        base = base.where(AuditLog.resource_type == resource_type)
    if q:
        like = f"%{q}%"
        base = base.where(or_(
            AuditLog.resource_name.ilike(like),
            AuditLog.detail.ilike(like),
        ))

    # total (for pagination) before limit/offset
    from sqlalchemy import func as _func
    total = db.scalar(select(_func.count()).select_from(base.subquery())) or 0

    rows = db.scalars(
        base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return AuditPage(rows=rows, total=total, limit=limit, offset=offset)


@router.get("/actions", response_model=list[str])
def distinct_actions(
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Distinct action values present, for populating the filter dropdown."""
    rows = db.scalars(
        select(AuditLog.action)
        .where(or_(
            AuditLog.organization_id == user.organization_id,
            AuditLog.organization_id.is_(None),
        ))
        .distinct()
        .order_by(AuditLog.action)
    ).all()
    return list(rows)
