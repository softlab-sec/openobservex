"""severity on alert rules + incidents

Revision ID: 0010_severity
Revises: 0009_incident_response
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_severity"
down_revision = "0009_incident_response"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("severity", sa.String(length=16), server_default="warning", nullable=False))
    op.add_column("incidents", sa.Column("severity", sa.String(length=16), server_default="warning", nullable=False))


def downgrade() -> None:
    op.drop_column("incidents", "severity")
    op.drop_column("alert_rules", "severity")
