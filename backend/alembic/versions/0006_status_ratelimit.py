"""org status + per-key rate limit

Revision ID: 0006_status_ratelimit
Revises: 0005_api_keys
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_status_ratelimit"
down_revision = "0005_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
    )
    op.add_column(
        "api_keys",
        sa.Column("rate_limit_rps", sa.Integer(), server_default="50", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("api_keys", "rate_limit_rps")
    op.drop_column("organizations", "status")
