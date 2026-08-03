"""incident response: ack/assign fields + timeline events

Revision ID: 0009_incident_response
Revises: 0008_rule_channels
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_incident_response"
down_revision = "0008_rule_channels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("incidents", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("incidents", sa.Column("acknowledged_by", sa.String(length=255), nullable=True))
    op.add_column("incidents", sa.Column("assigned_to", sa.String(length=255), nullable=True))
    op.create_table(
        "incident_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incident_events_incident_id", "incident_events", ["incident_id"])


def downgrade() -> None:
    op.drop_table("incident_events")
    op.drop_column("incidents", "assigned_to")
    op.drop_column("incidents", "acknowledged_by")
    op.drop_column("incidents", "acknowledged_at")
