"""add optional absolute evaluation range to slos

Revision ID: a8f1c3e5d7b9
Revises: a7d4f1b8c2e9
Create Date: 2026-08-27

An SLO evaluates either over a rolling window (window_days, the default) or,
when both window_start and window_end are set, over that fixed absolute range.
Both nullable so every existing SLO is untouched and keeps its rolling window.
"""
from alembic import op
import sqlalchemy as sa

revision = "a8f1c3e5d7b9"
down_revision = "a7d4f1b8c2e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("slos", sa.Column("window_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("slos", sa.Column("window_end", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("slos", "window_end")
    op.drop_column("slos", "window_start")
