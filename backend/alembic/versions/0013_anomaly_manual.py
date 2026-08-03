"""manual anomaly actions: resolution + suppression cooldown

Revision ID: 0013_anomaly_manual
Revises: 0012_anomaly_incidents
"""

from alembic import op
import sqlalchemy as sa

revision = "0013_anomaly_manual"
down_revision = "0012_anomaly_incidents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("anomalies", sa.Column("resolution", sa.String(length=16), server_default="auto", nullable=False))
    op.add_column("anomalies", sa.Column("suppressed_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("anomalies", "suppressed_until")
    op.drop_column("anomalies", "resolution")
