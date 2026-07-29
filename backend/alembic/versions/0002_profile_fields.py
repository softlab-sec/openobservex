"""add signup profile fields to users and organizations

Revision ID: 0002_profile_fields
Revises: 0001_initial
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_profile_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("job_title", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column(
        "organizations", sa.Column("industry", sa.String(length=128), nullable=True)
    )
    op.add_column(
        "organizations", sa.Column("company_size", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "organizations", sa.Column("country", sa.String(length=96), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("organizations", "country")
    op.drop_column("organizations", "company_size")
    op.drop_column("organizations", "industry")
    op.drop_column("users", "phone")
    op.drop_column("users", "job_title")
