"""add rate_threshold_per_min to slos for throughput SLIs

Revision ID: b9d4e2f7a1c3
Revises: a8f1c3e5d7b9
Create Date: 2026-08-27

Throughput SLOs measure the share of 1-minute buckets whose request count
meets a rate floor. That floor is a requests-per-minute value, a different
unit from latency_threshold_ms, so it gets its own nullable column rather
than overloading the latency threshold.
"""
from alembic import op
import sqlalchemy as sa

revision = "b9d4e2f7a1c3"
down_revision = "a8f1c3e5d7b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "slos",
        sa.Column("rate_threshold_per_min", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("slos", "rate_threshold_per_min")
