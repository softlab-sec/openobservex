"""allow incidents without a rule (anomaly-driven incidents)

Revision ID: 0012_anomaly_incidents
Revises: 0011_anomalies
"""

from alembic import op
import sqlalchemy as sa

revision = "0012_anomaly_incidents"
down_revision = "0011_anomalies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("incidents", "rule_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    op.alter_column("incidents", "rule_id", existing_type=sa.Uuid(), nullable=False)
