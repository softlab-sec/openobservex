"""API-key management: generate, list, revoke keys for an application.

Keys are shown in full exactly once (at creation). Afterwards only the public
prefix is ever returned. Ownership is enforced: a user can only manage keys for
applications their own organization owns.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.apikeys import generate_key
from app.db.postgres import get_db
from app.models import ApiKey, Application, User
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/applications", tags=["api-keys"])


class KeyOut(BaseModel):
    id: uuid.UUID
    prefix: str
    name: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    model_config = {"from_attributes": True}


class KeyCreated(BaseModel):
    """Returned ONCE at creation — includes the full secret key."""
    id: uuid.UUID
    prefix: str
    name: str
    full_key: str


class KeyIn(BaseModel):
    name: str = "default"


def _owned_app(app_id: uuid.UUID, user: User, db: Session) -> Application:
    app = db.get(Application, app_id)
    if not app or app.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.get("/{app_id}/keys", response_model=list[KeyOut])
def list_keys(app_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned_app(app_id, user, db)
    return db.scalars(
        select(ApiKey).where(ApiKey.application_id == app_id).order_by(ApiKey.created_at.desc())
    ).all()


@router.post("/{app_id}/keys", response_model=KeyCreated, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_key(app_id: uuid.UUID, body: KeyIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned_app(app_id, user, db)
    full_key, prefix, key_hash = generate_key()
    key = ApiKey(application_id=app_id, prefix=prefix, key_hash=key_hash, name=body.name)
    db.add(key)
    db.commit()
    db.refresh(key)
    record_audit(
        db, action="api_key.create", resource_type="api_key",
        actor=user, resource_id=key.id, resource_name=key.name,
        after={"prefix": key.prefix, "name": key.name, "application_id": str(app_id)},
        request=request,
    )
    return KeyCreated(id=key.id, prefix=key.prefix, name=key.name, full_key=full_key)


@router.delete("/{app_id}/keys/{key_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def revoke_key(app_id: uuid.UUID, key_id: uuid.UUID, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned_app(app_id, user, db)
    key = db.get(ApiKey, key_id)
    if not key or key.application_id != app_id:
        raise HTTPException(status_code=404, detail="Key not found")
    record_audit(
        db, action="api_key.revoke", resource_type="api_key",
        actor=user, resource_id=key.id, resource_name=key.name,
        before={"prefix": key.prefix, "name": key.name, "application_id": str(app_id)},
        request=request,
    )
    key.revoked_at = datetime.now(timezone.utc)
    db.commit()
