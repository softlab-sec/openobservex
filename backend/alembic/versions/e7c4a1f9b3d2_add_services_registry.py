"""add services registry

A curated overlay on telemetry-discovered services: ownership, criticality tier,
and the SLA commitment (target/window/metric) live on the service row. Telemetry
discovery stays the source of truth for which services exist; this table only adds
metadata, keyed uniquely by (organization_id, name).

Revision ID: e7c4a1f9b3d2
Revises: d2f6b4a8c3e5
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e7c4a1f9b3d2"
down_revision = "d2f6b4a8c3e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("owner", sa.String(length=255), nullable=True),
        sa.Column("team", sa.String(length=255), nullable=True),
        sa.Column("tags", sa.String(length=1024), nullable=True),
        sa.Column("criticality", sa.String(length=16), nullable=False, server_default="tier3"),
        sa.Column("sla_target_pct", sa.Float(), nullable=True),
        sa.Column("sla_window_days", sa.Integer(), nullable=True),
        sa.Column("sla_metric", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_services_org_name"),
    )
    op.create_index("ix_services_organization_id", "services", ["organization_id"])
    op.create_index("ix_services_name", "services", ["name"])


def downgrade() -> None:
    op.drop_index("ix_services_name", table_name="services")
    op.drop_index("ix_services_organization_id", table_name="services")
    op.drop_table("services")
