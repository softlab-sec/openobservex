import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # condition kind: error_rate | latency | log_spike | service_down
    kind: Mapped[str] = mapped_column(String(32), index=True)
    # optional scope: a single service, or NULL for all
    service: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # comparison operator: > | < | >= | <= | = | != (default > for existing rules)
    operator: Mapped[str] = mapped_column(String(4), default=">", server_default=">")
    # comparison threshold (percent, ms, count, depending on kind)
    threshold: Mapped[float] = mapped_column(Float)
    # for latency: which percentile (95 or 99)
    percentile: Mapped[int] = mapped_column(Integer, default=95)
    # sustained window in minutes the condition must hold
    for_minutes: Mapped[int] = mapped_column(Integer, default=5)
    # minimum sample size before a rule can fire (avoids noise on tiny traffic)
    min_samples: Mapped[int] = mapped_column(Integer, default=20)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    severity: Mapped[str] = mapped_column(String(16), default="warning", server_default="warning")
    # comma-separated webhook targets
    webhook_urls: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("alert_rules.id"), index=True, nullable=True
    )
    rule_name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    service: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # "firing" or "resolved"
    status: Mapped[str] = mapped_column(String(16), default="firing", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="warning", server_default="warning")
    observed_value: Mapped[float] = mapped_column(Float)
    threshold: Mapped[float] = mapped_column(Float)
    summary: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(255), nullable=True)


class IncidentEvent(Base):
    """One entry in an incident's timeline: fired, acknowledged, assigned, noted, resolved."""

    __tablename__ = "incident_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id"), index=True
    )
    kind: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
