"""expand slos with ownership/target model and add slo_status_history

Revision ID: a7d4f1b8c2e9
Revises: f6c3e9d4a2b7
Create Date: 2026-08-21

Phase 1 of the SLO redesign: services own SLOs (target_kind/target_ref with the
owning service as the spine), and a status-history time series is recorded so
breach duration, burn trend, projected exhaustion, and reporting become possible.
"""
from alembic import op
import sqlalchemy as sa


revision = "a7d4f1b8c2e9"
down_revision = "f6c3e9d4a2b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- new definition columns on slos (all nullable: safe against existing rows) ---
    op.add_column("slos", sa.Column("description", sa.String(length=1024), nullable=True))
    op.add_column("slos", sa.Column("owner", sa.String(length=255), nullable=True))
    op.add_column("slos", sa.Column("team", sa.String(length=255), nullable=True))
    op.add_column("slos", sa.Column("tags", sa.String(length=1024), nullable=True))
    op.add_column(
        "slos",
        sa.Column("target_kind", sa.String(length=32), nullable=False, server_default="service"),
    )
    op.add_column("slos", sa.Column("target_ref", sa.String(length=255), nullable=True))
    op.create_index("ix_slos_target_kind", "slos", ["target_kind"])

    # --- status history time series ---
    op.create_table(
        "slo_status_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slo_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("current_sli", sa.Float(), nullable=True),
        sa.Column("budget_remaining_pct", sa.Float(), nullable=True),
        sa.Column("burn_rate", sa.Float(), nullable=True),
        sa.Column("good_events", sa.Integer(), nullable=True),
        sa.Column("bad_events", sa.Integer(), nullable=True),
        sa.Column("total_events", sa.Integer(), nullable=True),
        sa.Column("is_meeting", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(["slo_id"], ["slos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_slo_status_history_slo_id", "slo_status_history", ["slo_id"])
    op.create_index("ix_slo_status_history_organization_id", "slo_status_history", ["organization_id"])
    op.create_index("ix_slo_status_history_evaluated_at", "slo_status_history", ["evaluated_at"])
    op.create_index("ix_slo_history_slo_time", "slo_status_history", ["slo_id", "evaluated_at"])


def downgrade() -> None:
    op.drop_index("ix_slo_history_slo_time", table_name="slo_status_history")
    op.drop_index("ix_slo_status_history_evaluated_at", table_name="slo_status_history")
    op.drop_index("ix_slo_status_history_organization_id", table_name="slo_status_history")
    op.drop_index("ix_slo_status_history_slo_id", table_name="slo_status_history")
    op.drop_table("slo_status_history")

    op.drop_index("ix_slos_target_kind", table_name="slos")
    op.drop_column("slos", "target_ref")
    op.drop_column("slos", "target_kind")
    op.drop_column("slos", "tags")
    op.drop_column("slos", "team")
    op.drop_column("slos", "owner")
    op.drop_column("slos", "description")
