"""Audit logging helper.

Endpoints call record_audit(...) at mutation points to append an immutable
row to audit_log. Reads are never audited. The helper is best-effort: an
audit write must never break the action it records, so failures are swallowed
and logged, not raised.

Design notes:
  - The actor's email and role are snapshotted into the row, so the record
    stays meaningful even if the user is later deleted or re-roled.
  - For deletes, call this BEFORE executing the delete (pass the object's
    current state as `before`), so the audit record survives the removal.
  - before/after are plain dicts (JSONB). Keep them small — the changed
    fields, not the whole ORM object.
"""
import logging
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User

logger = logging.getLogger("audit")


def client_ip(request: Request | None) -> str | None:
    """Best-effort client IP, honoring a reverse proxy's X-Forwarded-For."""
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # first hop is the original client
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def record_audit(
    db: Session,
    *,
    action: str,
    resource_type: str,
    actor: User | None = None,
    actor_email: str | None = None,
    actor_role: str | None = None,
    organization_id: Any = None,
    resource_id: Any = None,
    resource_name: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    request: Request | None = None,
    detail: str | None = None,
) -> None:
    """Append one audit row. Best-effort — never raises.

    Provide either `actor` (a User) or the explicit actor_email/actor_role
    (used for events where there is no logged-in user yet, e.g. a failed
    login attempt).
    """
    try:
        if actor is not None:
            actor_email = actor.email
            actor_role = actor.role
            if organization_id is None:
                organization_id = actor.organization_id
        row = AuditLog(
            organization_id=organization_id,
            actor_email=actor_email or "unknown",
            actor_role=actor_role or "unknown",
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            resource_name=resource_name,
            before=before,
            after=after,
            ip_address=client_ip(request),
            detail=detail,
        )
        db.add(row)
        db.commit()
    except Exception:
        # An audit failure must never break the user's action.
        logger.exception("failed to write audit row: action=%s type=%s", action, resource_type)
        try:
            db.rollback()
        except Exception:
            pass
