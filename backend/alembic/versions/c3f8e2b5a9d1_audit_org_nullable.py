"""make audit_log.organization_id nullable

Revision ID: c3f8e2b5a9d1
Revises: b2e7f1a9c4d3
Create Date: 2026-08-20

A failed login for an unknown email has no organization, but that is exactly
the event we most want to record (brute force against nonexistent accounts).
Allow a null org so those events are never dropped.
"""
from alembic import op
import sqlalchemy as sa

revision = "c3f8e2b5a9d1"
down_revision = "b2e7f1a9c4d3"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("audit_log", "organization_id", nullable=True)


def downgrade():
    op.alter_column("audit_log", "organization_id", nullable=False)
