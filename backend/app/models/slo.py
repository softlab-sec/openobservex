import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class SLO(Base):
    """A Service Level Objective.

    Definition columns describe the target; the status columns are a cache the
    worker refreshes periodically (rolling-window SLI math is too expensive to
    recompute on every page load), so the API/UI can read current state fast.
    """

    __tablename__ = "slos"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # what we measure: "availability" (non-error rate) | "latency" (fast-enough rate)
    sli_type: Mapped[str] = mapped_column(String(32), default="availability", index=True)
    # optional scope: a single service, or NULL for all services
    service: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # objective target as a percentage, e.g. 99.9
    target: Mapped[float] = mapped_column(Float)
    # rolling evaluation window in days, e.g. 30
    window_days: Mapped[int] = mapped_column(Integer, default=30)
    # for latency SLIs: a request is "good" if Duration <= this many ms. NULL for availability.
    latency_threshold_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- cached status, refreshed by the worker (NULL until first evaluation) ---
    # measured SLI over the window, as a percentage
    current_sli: Mapped[float | None] = mapped_column(Float, nullable=True)
    # percent of the error budget still remaining (100 = full budget, 0 = exhausted, <0 = over)
    budget_remaining_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    # recent budget-consumption rate (1.0 = burning exactly at the sustainable pace)
    burn_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # total requests seen in the window at last evaluation (context for the numbers)
    total_events: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # whether current_sli currently meets target
    is_meeting: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_evaluated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
