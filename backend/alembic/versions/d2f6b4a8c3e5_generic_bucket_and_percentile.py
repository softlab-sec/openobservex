"""rename throughput_bucket_seconds to bucket_seconds and add latency_percentile

The evaluation bucket window is shared by throughput and percentile-latency SLIs,
so the column moves from its throughput-specific name to a generic one. The rename
preserves existing throughput bucket-window values. latency_percentile stores which
percentile (0.5, 0.95, 0.99) a percentile-latency SLO measures.

Revision ID: d2f6b4a8c3e5
Revises: c1e5a3f9b2d4
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

revision = "d2f6b4a8c3e5"
down_revision = "c1e5a3f9b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("slos", "throughput_bucket_seconds", new_column_name="bucket_seconds")
    op.add_column("slos", sa.Column("latency_percentile", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("slos", "latency_percentile")
    op.alter_column("slos", "bucket_seconds", new_column_name="throughput_bucket_seconds")
