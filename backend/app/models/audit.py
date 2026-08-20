"""Append-only audit log for security-relevant and configuration-changing
actions (who did what, when).

Immutable by design: the application only ever INSERTs into this table. There
are no update or delete paths — not in the API, not in the models. That is
what makes it a trustworthy audit trail.

Phase 1 scope: auth events (login/logout/failed login), role changes, user
create/delete, API key create/revoke, alert rule CRUD, notification CRUD,
application CRUD, and incident actions. Reads are never audited.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id"), index=True, nullable=True
    )
    # When (UTC).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # Who — captured as email + role at the time of the action, so the record
    # stays meaningful even if the user is later deleted or their role changes.
    actor_email: Mapped[str] = mapped_column(String(320), index=True)
    actor_role: Mapped[str] = mapped_column(String(32))
    # What — dotted action like "alert_rule.delete", "user.role_change".
    action: Mapped[str] = mapped_column(String(64), index=True)
    # On what.
    resource_type: Mapped[str] = mapped_column(String(64), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    resource_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Before / after snapshots for updates (JSON). Null when not applicable.
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Where from, when available.
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Free-form extra context.
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
