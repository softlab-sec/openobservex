"""add slos table

Revision ID: f6c3e9d4a2b7
Revises: e5b2d7c8f3a1
Create Date: 2026-08-21

Service Level Objectives: a definition (target, window, SLI type) plus cached
status columns the worker refreshes.
"""
from alembic import op
import sqlalchemy as sa

revision = "f6c3e9d4a2b7"
down_revision = "e5b2d7c8f3a1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "slos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), index=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sli_type", sa.String(32), server_default="availability", nullable=False, index=True),
        sa.Column("service", sa.String(128), nullable=True),
        sa.Column("target", sa.Float(), nullable=False),
        sa.Column("window_days", sa.Integer(), server_default="30", nullable=False),
        sa.Column("latency_threshold_ms", sa.Float(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("current_sli", sa.Float(), nullable=True),
        sa.Column("budget_remaining_pct", sa.Float(), nullable=True),
        sa.Column("burn_rate", sa.Float(), nullable=True),
        sa.Column("total_events", sa.Integer(), nullable=True),
        sa.Column("is_meeting", sa.Boolean(), nullable=True),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("slos")
