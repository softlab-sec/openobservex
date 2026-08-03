"""anomalies table for statistical anomaly detection

Revision ID: 0011_anomalies
Revises: 0010_severity
"""

import sqlalchemy as sa
from alembic import op

revision = "0011_anomalies"
down_revision = "0010_severity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "anomalies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("service", sa.String(length=128), nullable=False),
        sa.Column("metric", sa.String(length=32), nullable=False),
        sa.Column("observed", sa.Float(), nullable=False),
        sa.Column("baseline_mean", sa.Float(), nullable=False),
        sa.Column("baseline_std", sa.Float(), nullable=False),
        sa.Column("z_score", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(length=16), server_default="warning", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("occurrences", sa.Integer(), server_default="1", nullable=False),
        sa.Column("consecutive_hits", sa.Integer(), server_default="1", nullable=False),
        sa.Column("first_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("promoted_incident_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["promoted_incident_id"], ["incidents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_anomalies_organization_id", "anomalies", ["organization_id"])
    op.create_index("ix_anomalies_service", "anomalies", ["service"])
    op.create_index("ix_anomalies_metric", "anomalies", ["metric"])
    op.create_index("ix_anomalies_status", "anomalies", ["status"])


def downgrade() -> None:
    op.drop_index("ix_anomalies_status", table_name="anomalies")
    op.drop_index("ix_anomalies_metric", table_name="anomalies")
    op.drop_index("ix_anomalies_service", table_name="anomalies")
    op.drop_index("ix_anomalies_organization_id", table_name="anomalies")
    op.drop_table("anomalies")
