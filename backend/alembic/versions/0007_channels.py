"""notification channels

Revision ID: 0007_channels
Revises: 0006_status_ratelimit
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_channels"
down_revision = "0006_status_ratelimit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_channels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_channels_organization_id", "notification_channels", ["organization_id"])
    op.create_index("ix_notification_channels_kind", "notification_channels", ["kind"])


def downgrade() -> None:
    op.drop_table("notification_channels")
