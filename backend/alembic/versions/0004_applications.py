"""applications: map orgs to tenant tags

Revision ID: 0004_applications
Revises: 0003_alerting
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_applications"
down_revision = "0003_alerting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tenant_tag", sa.String(length=128), nullable=False),
        sa.Column("namespace", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_tag", name="uq_applications_tenant_tag"),
    )
    op.create_index("ix_applications_organization_id", "applications", ["organization_id"])
    op.create_index("ix_applications_tenant_tag", "applications", ["tenant_tag"])


def downgrade() -> None:
    op.drop_table("applications")
