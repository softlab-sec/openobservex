"""alert rule -> channel routing

Revision ID: 0008_rule_channels
Revises: 0007_channels
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_rule_channels"
down_revision = "0007_channels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("channel_ids", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("alert_rules", "channel_ids")
