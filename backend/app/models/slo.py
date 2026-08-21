import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, func
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
    # --- ownership & classification (services own SLOs; see target_kind/target_ref) ---
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    team: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # comma-separated tags (same convention as webhook_urls/channel_ids elsewhere)
    tags: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # what this SLO is attached to: "service" | "api" | "endpoint" | "infrastructure".
    # the owning service always lives in the `service` column above (the ownership spine);
    # target_ref names the specific object within the kind (route, host, component, ...).
    target_kind: Mapped[str] = mapped_column(String(32), default="service", index=True)
    target_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
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


class SLOStatusHistory(Base):
    """A point-in-time snapshot of an SLO's status, appended by the worker each cycle.

    The `slos` table only holds the *latest* status (it's overwritten every
    evaluation). This table is the time series: it's what makes breach start and
    duration, burn-rate trend, projected budget exhaustion, breach history, and
    future compliance reporting possible. One small row per SLO per cycle.
    """
    __tablename__ = "slo_status_history"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("slos.id", ondelete="CASCADE"), index=True
    )
    # denormalized so history can be queried org-scoped without joining slos
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    evaluated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    current_sli: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_remaining_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    burn_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # good/bad/total stored (not just the ratio) so history is fully re-derivable
    good_events: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bad_events: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_events: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_meeting: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    __table_args__ = (
        Index("ix_slo_history_slo_time", "slo_id", "evaluated_at"),
    )
