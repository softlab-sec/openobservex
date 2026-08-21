"""add department column to users

Revision ID: e5b2d7c8f3a1
Revises: d4a9c1e6f2b8
Create Date: 2026-08-20

Registration collects an optional department for organizational context.
"""
from alembic import op
import sqlalchemy as sa

revision = "e5b2d7c8f3a1"
down_revision = "d4a9c1e6f2b8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("department", sa.String(128), nullable=True))


def downgrade():
    op.drop_column("users", "department")
