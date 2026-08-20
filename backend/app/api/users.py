"""User management (admin-only): list users, change roles, activate/deactivate.

Every mutation is audited. Anti-lockout guards prevent an admin from changing
their own role or deactivating themselves, so an org can never lock out its
last administrator by accident.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.audit import record_audit
from app.core.roles import require_role
from app.db.postgres import get_db
from app.models import User

router = APIRouter(prefix="/api/v1/users", tags=["users"])

_ROLES = {"admin", "member", "viewer"}


class UserRow(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    role: str
    is_active: bool
    model_config = {"from_attributes": True}


class RoleChange(BaseModel):
    role: str


class ActiveChange(BaseModel):
    is_active: bool


@router.get("", response_model=list[UserRow])
def list_users(
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return db.scalars(
        select(User)
        .where(User.organization_id == user.organization_id)
        .order_by(User.email)
    ).all()


def _target(user_id: uuid.UUID, actor: User, db: Session) -> User:
    u = db.get(User, user_id)
    if not u or u.organization_id != actor.organization_id:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.patch("/{user_id}/role", response_model=UserRow)
def change_role(
    user_id: uuid.UUID,
    body: RoleChange,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if body.role not in _ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {sorted(_ROLES)}")
    target = _target(user_id, actor, db)
    if target.id == actor.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")
    old_role = target.role
    if old_role == body.role:
        return target  # no change, nothing to audit
    target.role = body.role
    db.commit()
    db.refresh(target)
    record_audit(
        db, action="user.role_change", resource_type="user",
        actor=actor, resource_id=target.id, resource_name=target.email,
        before={"role": old_role}, after={"role": body.role}, request=request,
    )
    return target


@router.patch("/{user_id}/active", response_model=UserRow)
def change_active(
    user_id: uuid.UUID,
    body: ActiveChange,
    request: Request,
    actor: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = _target(user_id, actor, db)
    if target.id == actor.id:
        raise HTTPException(status_code=400, detail="You cannot change your own active status.")
    if target.is_active == body.is_active:
        return target
    target.is_active = body.is_active
    db.commit()
    db.refresh(target)
    record_audit(
        db,
        action=("user.activate" if body.is_active else "user.deactivate"),
        resource_type="user",
        actor=actor, resource_id=target.id, resource_name=target.email,
        before={"is_active": not body.is_active}, after={"is_active": body.is_active},
        request=request,
    )
    return target
