import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class Anomaly(Base):
    """A statistically significant deviation of a (service, metric) from its
    rolling baseline. One row represents one deviation episode: while the
    deviation persists it is updated in place (dedup); when the metric returns
    to baseline it is marked resolved. Sustained episodes may be promoted to
    an incident (hysteresis gate).
    """

    __tablename__ = "anomalies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )

    # the anomaly key: one active row per (org, service, metric)
    service: Mapped[str] = mapped_column(String(128), index=True)
    # metric: error_rate | p95_latency
    metric: Mapped[str] = mapped_column(String(32), index=True)

    # the deviation and the baseline it was measured against
    observed: Mapped[float] = mapped_column(Float)
    baseline_mean: Mapped[float] = mapped_column(Float)
    baseline_std: Mapped[float] = mapped_column(Float)
    z_score: Mapped[float] = mapped_column(Float)

    # critical | warning | info, derived from deviation magnitude
    severity: Mapped[str] = mapped_column(String(16), default="warning")

    # lifecycle: active | resolved
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)

    # persistence counters (drive promotion hysteresis)
    occurrences: Mapped[int] = mapped_column(Integer, default=1)
    consecutive_hits: Mapped[int] = mapped_column(Integer, default=1)

    # episode lifespan
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # link to the incident this anomaly was promoted to (if any)
    promoted_incident_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("incidents.id"), nullable=True
    )
