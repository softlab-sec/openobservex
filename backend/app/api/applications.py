"""Applications API: an org's telemetry sources (tenants).

Each application maps a telemetry tenant tag (ResourceAttributes['tenant.id'])
and namespace to the owning organization. This is what makes multi-tenant
isolation real: queries only ever see tags their org owns.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.models import Application, User
from app.core.roles import require_role
from app.core.audit import record_audit

router = APIRouter(prefix="/api/v1/applications", tags=["applications"])


class AppIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tenant_tag: str = Field(min_length=1, max_length=128)
    namespace: str = Field(min_length=1, max_length=128)


class AppOut(BaseModel):
    id: uuid.UUID
    name: str
    tenant_tag: str
    namespace: str
    created_at: datetime
    model_config = {"from_attributes": True}


def owned_tags(db: Session, org_id: uuid.UUID) -> list[str]:
    """Tenant tags this org owns — the isolation whitelist for queries."""
    return list(
        db.scalars(
            select(Application.tenant_tag).where(Application.organization_id == org_id)
        ).all()
    )


@router.get("", response_model=list[AppOut])
def list_applications(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return db.scalars(
        select(Application)
        .where(Application.organization_id == user.organization_id)
        .order_by(Application.created_at)
    ).all()


@router.post("", response_model=AppOut, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_application(
    body: AppIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.scalar(select(Application).where(Application.tenant_tag == body.tenant_tag))
    if existing:
        raise HTTPException(status_code=409, detail="tenant_tag already in use")
    app = Application(
        organization_id=user.organization_id,
        name=body.name,
        tenant_tag=body.tenant_tag,
        namespace=body.namespace,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    record_audit(
        db, action="application.create", resource_type="application",
        actor=user, resource_id=app.id, resource_name=app.name,
        after={"name": app.name, "tenant_tag": app.tenant_tag, "namespace": app.namespace},
        request=request,
    )
    return app


@router.delete("/{app_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_application(
    app_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    app = db.get(Application, app_id)
    if not app or app.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Application not found")
    record_audit(
        db, action="application.delete", resource_type="application",
        actor=user, resource_id=app.id, resource_name=app.name,
        before={"name": app.name},
        detail="deleting an application also removes its API keys",
        request=request,
    )
    db.delete(app)
    db.commit()


# --- tenant scoping dependency (ASYNC so the ContextVar it sets propagates
#     into the sync endpoint's worker thread via anyio context copy) ---

from app.core.tenant import TenantContext, set_tenant_context  # noqa: E402


async def tenant_dependency(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TenantContext:
    """Resolve the caller's owned tenant tags and install them for this request."""
    tags = owned_tags(db, user.organization_id)
    ctx = TenantContext(org_id=str(user.organization_id), owned_tags=tags)
    set_tenant_context(ctx)
    return ctx
