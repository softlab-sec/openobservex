import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.postgres import Base


class MaintenanceWindow(Base):
    """A planned window during which alert firing is suppressed.

    While an active window covers a rule's service (or is org-wide), the
    evaluator still evaluates but does NOT create incidents, so planned
    work (deploys, migrations, downtime) does not generate noise.

    service is NULL for an org-wide window (suppresses everything).
    Otherwise it matches a rule's target service exactly.
    """
    __tablename__ = "maintenance_windows"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    reason: Mapped[str] = mapped_column(String(255))
    service: Mapped[str | None] = mapped_column(String(255), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
