"""add throughput bucket window and rate unit for flexible throughput SLOs

Revision ID: c1e5a3f9b2d4
Revises: b9d4e2f7a1c3
Create Date: 2026-08-31

Throughput SLOs let the user choose the evaluation bucket window (per-minute,
per-5-minute, per-hour) and the rate unit the floor is expressed in. The floor
stays normalized to requests-per-minute in rate_threshold_per_min; these two
columns record the bucket window the engine groups by and the display unit so
the builder can round-trip the entered value.
"""
from alembic import op
import sqlalchemy as sa

revision = "c1e5a3f9b2d4"
down_revision = "b9d4e2f7a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("slos", sa.Column("throughput_bucket_seconds", sa.Integer(), nullable=True))
    op.add_column("slos", sa.Column("throughput_rate_unit", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("slos", "throughput_rate_unit")
    op.drop_column("slos", "throughput_bucket_seconds")
