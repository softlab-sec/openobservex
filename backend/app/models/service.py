import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class Service(Base):
    """A curated service in the registry.

    Overlay model: telemetry discovery (distinct ServiceName in otel_traces) stays
    the source of truth for which services EXIST. This table only adds curated
    metadata to a service -- ownership, criticality, and the SLA commitment --
    keyed by the service name within an organization. A row may also pre-register
    a service that is not emitting telemetry yet.

    SLOs attach to a service by name via slos.service (the ownership spine). The
    SLA stored here is the reliability COMMITMENT the service makes; the SLOs are
    the operational measurements that evidence it. The two are deliberately
    distinct: an SLA is a promise reported on, an SLO is how it is measured.
    """

    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_services_org_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    # the telemetry ServiceName this row curates (overlay key, unique within the org)
    name: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # --- ownership ---
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    team: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # comma-separated tags (same convention as slos.tags)
    tags: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # criticality tier, ordinal: "tier1" (mission critical) .. "tier4" (low).
    criticality: Mapped[str] = mapped_column(String(16), default="tier3")

    # --- SLA commitment (nullable so a service can be curated before an SLA is set) ---
    # target as a percentage (e.g. 99.9), window in days (e.g. 30), and the metric
    # the commitment is expressed on ("availability" | "latency").
    sla_target_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    sla_window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_metric: Mapped[str | None] = mapped_column(String(16), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
